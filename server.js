import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

// ===== פונקציות עזר לחיפוש =====
const stripPunct = s => s.replace(/[\"'()\-_,.?!:;·•]/g, ' ').replace(/\s+/g,' ').trim();
const normalizeHeb = s => s
  .replace(/[״”“„]/g, '"')
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
      if (t===k || arr.includes(t)) expanded.push(k, ...arr);
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

// ===== דירוג חכם =====
function scoreTitle(query, title) {
  const tq = tokenize(query);
  const tt = tokenize(title || '');
  let s = jaccard(tq, tt);

  const cleanQuery = normalizeHeb(query).replace(/['״׳׳’‘`]/g, '').trim();
  const cleanTitle = normalizeHeb(title).replace(/['״׳׳’‘`]/g, '').trim();

  const contentWords = tq.filter(t => !stopwords.has(t));
  const allIn = contentWords.every(t => cleanTitle.includes(t));
  if (allIn) s += 0.25;

  const firstWord = contentWords[0];
  if (firstWord && cleanTitle.startsWith(firstWord)) s += 0.15;

  const orderSimilar = cleanTitle.includes(cleanQuery) || cleanQuery.includes(cleanTitle);
  if (orderSimilar) s += 0.2;

  return Math.min(s, 1);
}

// ===== טעינת נתונים מכל הטבלאות =====
async function loadAll() {
  console.log('🔄 טוען נתונים מ-Supabase...');

  // מתכונים (עם raw_text)
  {
    const { data, error } = await supabase.from('recipes_raw_view').select('*');
    if (error) throw error;
    recipes = data || [];
  }

  // שאר הטבלאות
  { const { data, error } = await supabase.from('substitutions_clean').select('*'); if (error) throw error; subs = data||[]; }
  { const { data, error } = await supabase.from('nutrition_lookup_v2').select('*'); if (error) throw error; nutrition = data||[]; }
  { const { data, error } = await supabase.from('units_densities_lookup_v2').select('*'); if (error) throw error; units = data||[]; }
  { const { data, error } = await supabase.from('vegan_lookup_full (2)').select('*'); if (error) throw error; veganLookup = data||[]; }
  { const { data, error } = await supabase.from('master_list_items (1)').select('*'); if (error) throw error; masterList = data||[]; }
  { const { data, error } = await supabase.from('pricebook_master (2)').select('*'); if (error) throw error; pricebook = data||[]; }
  { const { data, error } = await supabase.from('shopping_list_meal_prep_with_recipes (1)').select('*'); if (error) throw error; mealPrep = data||[]; }

  console.log(`✅ נטענו ${recipes.length} מתכונים; ${subs.length} תחליפים; ${nutrition.length} ערכי תזונה; ${units.length} יחידות; ${veganLookup.length} טבעוני; ${masterList.length} מאסטר; ${pricebook.length} מחירון; ${mealPrep.length} הכנות`);
}

// ===== חיפוש Strict Mode =====
function findBestRecipeRaw(query) {
  if (!recipes.length) return null;
  const scored = recipes.map(r => ({ r, s: scoreTitle(query, r.title || r.name || '') }))
                        .sort((a, b) => b.s - a.s);
  const top = scored[0];
  if (!top || top.s < 0.25) return null;
  const rec = top.r;
  const raw = rec.raw_text || rec.raw || rec.full_text || null;
  return raw ? String(raw) : null;
}

// ===== הקשר לבקשות כלליות =====
function buildAssistantContext() {
  return { substitutions: subs, nutrition, units, veganLookup, masterList, pricebook, mealPrep };
}

// ===== אפליקציה =====
app.use(cors());
app.use(express.json());

app.get('/', (req,res)=>res.json({ status: 'ok', recipes: recipes.length }));

app.post('/chat', async (req,res)=>{
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'missing message' });
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
        { role: 'system', content: `את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף. השתמשי במאגרים לוגיים (תחליפים, יחידות, תזונה).` },
        { role: 'user', content: m }
      ]
    });
    const reply = completion.choices?.[0]?.message?.content || 'לא התקבלה תשובה.';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});

app.listen(PORT, async ()=>{
  await loadAll();
  console.log(`🍪 קוקישף רצה על פורט ${PORT}`);
});
