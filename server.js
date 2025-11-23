import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// הגדרת OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// חיבור ל-Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===== מאגרי נתונים בזיכרון =====
let recipes = [];
let subs = [];
let nutrition = [];
let units = [];
let veganLookup = [];
let masterList = [];
let pricebook = [];
let mealPrep = [];

// ===== פונקציות עזר =====
const stripPunct = s => s.replace(/[\"'()\-_,.?!:;·•]/g, ' ').replace(/\s+/g,' ').trim();
const normalizeHeb = s => s
  .replace(/[״״”“„]/g, '"')
  .replace(/[׳’‘`]/g, "'")
  .replace(/[ך]/g,'כ').replace(/[ם]/g,'מ').replace(/[ן]/g,'נ').replace(/[ף]/g,'פ').replace(/[ץ]/g,'צ')
  .toLowerCase();

const stopwords = new Set(['עם','ו','של','ל','ה','את','על','vegan','טבעוני','טבעונית','ללא','גלוטן','מהאתר']);
const eqMap = new Map([
  ['oreo',['אוראו','אוריאו']],
  ['גבינה',['צ׳יזקייק','cheesecake','cheese']],
  ['עוגיות',['עוגיה','cookies','cookie','קוקי']],
  ['עוגת גבינה',['גבינה']]
]);

function tokenize(q){
  let s = normalizeHeb(stripPunct(q));
  let toks = s.split(' ').filter(t=>t && !stopwords.has(t));
  const expanded = [];
  for (const t of toks) {
    expanded.push(t);
    for (const [k, arr] of eqMap) {
      if (t===k || arr.includes(t)) {
        expanded.push(k, ...arr);
      }
    }
  }
  return Array.from(new Set(expanded));
}

function jaccard(a,b){
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x=>B.has(x)).length;
  const uni = new Set([...A,...B]).size;
  return uni ? inter/uni : 0;
}

function scoreTitle(query, title){
  const tq = tokenize(query);
  const tt = tokenize(title||'');
  let s = jaccard(tq, tt);
  const contentWords = tq.filter(t=>!stopwords.has(t));
  const allIn = contentWords.every(t=>tt.includes(t));
  if (allIn) s += 0.15;
  const orderSimilar = normalizeHeb(query).includes(normalizeHeb(title||'')) || normalizeHeb(title||'').includes(normalizeHeb(query));
  if (orderSimilar) s += 0.10;
  return s;
}

// ===== טעינת נתונים מכל הטבלאות =====
async function loadAll() {
  console.log('🔄 טוען נתונים מ-Supabase...');

  // מתכונים (Strict Mode דרך VIEW עם raw_text)
  {
    const { data, error } = await supabase.from('recipes_raw_view').select('*');
    if (error) throw error;
    recipes = data || [];
  }

  // תחליפים
  { const { data, error } = await supabase.from('substitutions_clean').select('*'); if (error) throw error; subs = data||[]; }

  // תזונה
  { const { data, error } = await supabase.from('nutrition_lookup_v2').select('*'); if (error) throw error; nutrition = data||[]; }

  // יחידות/צפיפויות
  { const { data, error } = await supabase.from('units_densities_lookup_v2').select('*'); if (error) throw error; units = data||[]; }

  // טבעוני/תאימות מוצרים
  { const { data, error } = await supabase.from('vegan_lookup_full (2)').select('*'); if (error) throw error; veganLookup = data||[]; }

  // רשימת פריטים כללית
  { const { data, error } = await supabase.from('master_list_items (1)').select('*'); if (error) throw error; masterList = data||[]; }

  // מחירון
  { const { data, error } = await supabase.from('pricebook_master (2)').select('*'); if (error) throw error; pricebook = data||[]; }

  // הכנות/תכנון שבועי
  { const { data, error } = await supabase.from('shopping_list_meal_prep_with_recipes (1)').select('*'); if (error) throw error; mealPrep = data||[]; }

  console.log(`✅ נטענו ${recipes.length} מתכונים; ${subs.length} תחליפים; ${nutrition.length} ערכי תזונה; ${units.length} יחידות; ${veganLookup.length} פריטים טבעוניים; ${masterList.length} מאסטר; ${pricebook.length} מחירון; ${mealPrep.length} הכנות`);
}

// ===== חיפוש חכם ושליפה מדויקת =====
function findBestRecipeRaw(query) {
  if (!recipes.length) return null;
  const scored = recipes.map(r => ({ r, s: scoreTitle(query, r.title || r.name || '') }))
                        .sort((a,b)=>b.s - a.s);
  const top = scored[0];
  if (!top || top.s < 0.55) return null;
  const rec = top.r;
  const raw = rec.raw_text || rec.raw || rec.full_text || null;
  return raw ? String(raw) : null;
}

// ===== תזמון תשובות רגילות =====
function buildAssistantContext() {
  return { substitutions: subs, nutrition, units, veganLookup, masterList, pricebook, mealPrep };
}

// Middleware
app.use(cors());
app.use(express.json());

// בריאות
app.get('/', (req,res)=>{
  res.json({ status: 'running', message: '🍪 שרת קוקישף מחובר ל-Supabase!', recipesLoaded: recipes.length });
});

// צ'אט
app.post('/chat', async (req,res)=>{
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string')
      return res.status(400).json({ error: 'חסר שדה message בבקשה.' });

    const m = message.trim();
    const isRecipeRequest = /(^|\s)(מתכון|איך מכינים|תני לי|בא לי להכין)(\s|$)/.test(m);

    if (isRecipeRequest) {
      const raw = findBestRecipeRaw(m);
      if (!raw)
        return res.json({ reply: 'לא נמצא מתכון תואם במאגר קוקישף.\nהאם תרצי שאיצור עבורך גרסה חדשה בהשראת קוקישף?' });
      return res.send(raw);
    }

    const ctx = buildAssistantContext();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: `את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף.
דברי בטון חם, נעים ובגובה העיניים.
השתמשי בנתוני Supabase (תחליפים, תזונה, יחידות, מחירים, תפריטים).
כאשר מבקשת מתכון — החזירי רק את הטקסט המקורי מתוך recipes_raw_view.`
        },
        { role: 'user', content: m }
      ]
    });
    const reply = completion.choices?.[0]?.message?.content || 'לא התקבלה תשובה.';
    res.json({ reply });
  } catch (err) {
    console.error('❌', err);
    res.status(500).json({ error: 'שגיאה פנימית' });
  }
});

// ===== הפעלת השרת =====
app.listen(PORT, async ()=>{
  await loadAll();
  console.log(`
╔════════════════════════════════════════╗
║   🍪 שרת קוקישף מוכן לשימוש!        ║
╠════════════════════════════════════════╣
║   📡 Port: ${String(PORT).padEnd(27)} ║
║   📚 מתכונים: ${String(recipes.length).padEnd(21)} ║
║   🤖 OpenAI: מחובר                    ║
╚════════════════════════════════════════╝
  `);
});
