import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

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

// ===== ניקוי טקסט וניקוד =====
const stripPunct = (s) => s.replace(/["'()\-_,.?!:;·•]/g, " ").replace(/\s+/g, " ").trim();
const normalizeHeb = (s) =>
  s
    .replace(/[״”“„]/g, '"')
    .replace(/[׳’‘`]/g, "'")
    .replace(/[ך]/g, "כ")
    .replace(/[ם]/g, "מ")
    .replace(/[ן]/g, "נ")
    .replace(/[ף]/g, "פ")
    .replace(/[ץ]/g, "צ")
    .toLowerCase();

const stopwords = new Set([
  "עם","ו","של","ל","ה","את","על",
  "vegan","טבעוני","טבעונית","ללא","גלוטן","מהאתר"
]);

const eqMap = new Map([
  ["oreo", ["אוראו","אוריאו"]],
  ["גבינה", ["צ׳יזקייק","cheesecake","cheese"]],
  ["עוגיות", ["עוגיה","cookies","cookie","קוקי"]],
  ["צ'יפס", ["ציפס","chips","chip"]],
  ["עוגת גבינה", ["גבינה"]],
]);

function tokenize(q){
  let s = normalizeHeb(stripPunct(q));
  let toks = s.split(" ").filter(t => t && !stopwords.has(t));
  const expanded = [];
  for (const t of toks){
    expanded.push(t);
    for (const [k, arr] of eqMap){
      if (t === k || arr.includes(t)) expanded.push(k, ...arr);
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

// ===== דירוג חכם עם עדיפות לעוגיות צ'יפס =====
function scoreTitle(query, title){
  const tq = tokenize(query);
  const tt = tokenize(title || "");
  let s = jaccard(tq, tt);

  const cleanQuery = normalizeHeb(query)
    .replace(/['״׳’‘`]/g, "")
    .replace(/צ׳/g, "צ")
    .trim();

  const cleanTitle = normalizeHeb(title)
    .replace(/['״׳’‘`]/g, "")
    .replace(/צ׳/g, "צ")
    .trim();

  const contentWords = tq.filter(t=>!stopwords.has(t));

  // בונוסים ממוקדים לכוונה
  if (cleanTitle.includes("עוגיות")) s += 0.4;
  if (cleanTitle.includes("צ'יפס") || cleanTitle.includes("ציפס")) s += 0.35;
  if (cleanTitle.includes("שוקולד")) s += 0.15;

  const allIn = contentWords.every(t => cleanTitle.includes(t));
  if (allIn) s += 0.2;

  const firstWord = contentWords[0];
  if (firstWord && cleanTitle.startsWith(firstWord)) s += 0.1;

  const orderSimilar = cleanTitle.includes(cleanQuery) || cleanQuery.includes(cleanTitle);
  if (orderSimilar) s += 0.2;

  return Math.min(s, 1);
}

// ===== טעינת נתונים מכל הטבלאות =====
async function loadAll() {
  console.log("🔄 טוען נתונים מ־Supabase...");

  const { data: recipesData, error: recipesError } = await supabase.from("recipes_raw_view").select("*");
  if (recipesError) throw recipesError;
  recipes = recipesData || [];

  const { data: subsData } = await supabase.from("substitutions_clean").select("*");
  subs = subsData || [];

  const { data: nutritionData } = await supabase.from("nutrition_lookup_v2").select("*");
  nutrition = nutritionData || [];

  const { data: unitsData } = await supabase.from("units_densities_lookup_v2").select("*");
  units = unitsData || [];

  const { data: veganData } = await supabase.from("vegan_lookup_full (2)").select("*");
  veganLookup = veganData || [];

  const { data: masterData } = await supabase.from("master_list_items (1)").select("*");
  masterList = masterData || [];

  const { data: priceData } = await supabase.from("pricebook_master (2)").select("*");
  pricebook = priceData || [];

  const { data: mealData } = await supabase.from("shopping_list_meal_prep_with_recipes (1)").select("*");
  mealPrep = mealData || [];

  console.log(`✅ נטענו ${recipes.length} מתכונים; ${subs.length} תחליפים; ${nutrition.length} תזונה; ${units.length} יחידות; ${veganLookup.length} טבעוני; ${masterList.length} מאסטר; ${pricebook.length} מחירון; ${mealPrep.length} הכנות`);
}

// ===== עיצוב HTML למתכון (משופר) =====
function formatRecipeHTML(text){
  if (!text) return "";
  let t = text;

  // ניקוי בסיסי, הסרת "קודם הבא" ונקודות מרובות
  t = t
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/([.]{3,}|[.]\s*[.]\s*[.])/g, "")
    .replace(/(קודם\s*הבא)/gi, "")
    .trim();

  // חילוץ חלקים לפי כותרות/אימוג'ים/מילים מפתח
  const parts = { title: "", ingredients: "", steps: "", notes: "" };
  const lines = t.split(/\n+/).map(l => l.trim()).filter(Boolean);

  let section = "title";
  for (const l of lines){
    if (/^🧾/.test(l) || /מרכיבים[:：]/.test(l)) { section = "ingredients"; continue; }
    if (/^👩‍🍳/.test(l) || /אופן הכנה[:：]/.test(l)) { section = "steps"; continue; }
    if (/^הערות/.test(l) || /הערות והמרות/.test(l)) { section = "notes"; continue; }

    if (section === "ingredients") parts.ingredients += l + "\n";
    else if (section === "steps") parts.steps += l + "\n";
    else if (section === "notes") parts.notes += l + "\n";
    else parts.title += l + " ";
  }

  // ---- מרכיבים לרשימת UL: ננסה לפצל על בסיס כמויות/תווים רלוונטיים ----
  const ingredientsItems = parts.ingredients
    .replace(/^\s*כ\d+\s*עוגיות.*$/m, "") // מסיר שורת "כ20 עוגיות" אם קיימת
    .split(/(?=(?:\d+\s*כוס|כוס|גרם|מ״ל|מיליליטר|כפות|כפית|כפיות|כף|\(|\*|-)\s*)/i)
    .map(s => s.trim())
    .filter(s => s && s.length > 1);

  const ingredientsHTML = ingredientsItems.length
    ? ingredientsItems.map(i => `<li>${i}</li>`).join("")
    : parts.ingredients.split(/\s{2,}|\n/).map(i => i.trim()).filter(Boolean).map(i => `<li>${i}</li>`).join("");

  // ---- שלבים לרשימת OL: פיצול לפי "1. 2. 3." ----
  const stepItems = parts.steps
    .replace(/\*\*/g, "") // מסיר bold שסוגרו לא טוב
    .split(/(?=\d+\.)/)
    .map(s => s.replace(/^\s*(\d+)\.\s*/, (m, d)=> `${d}. `).trim())
    .filter(Boolean);

  const stepsHTML = stepItems.length
    ? stepItems.map(s => `<li>${s}</li>`).join("")
    : parts.steps.split(/\n+/).map(s => s.trim()).filter(Boolean).map(s => `<li>${s}</li>`).join("");

  // ---- הערות: מפצל למשפטים קצרים ----
  const notesHTML = parts.notes
    .replace(/^\s*הערות.*?:?\s*/i, "")
    .split(/(?<=[.!?])\s+/)
    .map(n => n.trim())
    .filter(Boolean)
    .map(n => `<li>${n}</li>`)
    .join("");

  // כותרת מסודרת
  const titleText = parts.title
    .replace(/^🍰\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return `
  <div style="direction:rtl;text-align:right;font-family:'Assistant',sans-serif;line-height:1.8;color:#4a2c06;background:#fffaf4;padding:20px;border-radius:12px;">
    <p style="margin:0 0 10px 0;">🍪 הנה אחד המתכונים המעולים מהבלוג של קוקי כיף!<br>(יש עוד גרסאות באתר 💚)</p>
    ${titleText ? `<h2 style="margin:4px 0 12px 0;">${titleText}</h2>` : ""}

    <h3 style="margin:10px 0 6px 0;">🧾 מרכיבים</h3>
    <ul style="margin:0 0 12px 0; padding-inline-start:20px;">${ingredientsHTML}</ul>

    <h3 style="margin:10px 0 6px 0;">👩‍🍳 אופן הכנה</h3>
    <ol style="margin:0; padding-inline-start:20px;">${stepsHTML}</ol>

    ${notesHTML ? `
      <h3 style="margin:12px 0 6px 0;">📌 הערות והמרות</h3>
      <ul style="margin:0; padding-inline-start:20px;">${notesHTML}</ul>` : ""}
  </div>`;
}

// ===== חיפוש Strict Mode =====
function findBestRecipeRaw(query) {
  if (!recipes.length) return null;
  const scored = recipes
    .map(r => ({ r, s: scoreTitle(query, r.title || r.name || "") }))
    .sort((a,b)=>b.s - a.s);

  const top = scored[0];
  if (!top || top.s < 0.1) return null;

  console.log("🔍 TOP MATCH:", top.r.title, "→", top.s);
  const rec = top.r;
  const raw = rec.raw_text || rec.raw || rec.full_text || null;
  return raw ? String(raw) : null;
}

// ===== CORS =====
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "https://cookiecef.co.il",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));
app.use(express.json());

// ===== ראוטים =====
app.get("/", (req,res)=>res.json({ status: "ok", recipes: recipes.length, message: "🍪 קוקישף רצה בהצלחה!" }));

app.post("/chat", async (req,res)=>{
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "missing message" });

    const m = message.trim();
    const isRecipeRequest = /(^|\s)(מתכון|איך מכינים|תני לי|בא לי להכין)(\s|$)/.test(m);

    if (isRecipeRequest){
      const raw = findBestRecipeRaw(m);
      if (!raw){
        return res.json({
          reply: "<p>לא נמצא מתכון תואם במאגר קוקישף 🍪</p><p>תרצי שאיצור עבורך גרסה חדשה בהשראת קוקישף?</p>"
        });
      }
      const html = formatRecipeHTML(raw);
      return res.json({ reply: html }); // שולחים HTML עטוף ב-JSON
    }

    // תשובה חכמה כללית
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        { role: "system", content: `את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף. הסתמכי על מאגר קוקישף ותני מענה חם וברור.` },
        { role: "user", content: m }
      ]
    });
    const reply = completion.choices?.[0]?.message?.content || "לא התקבלה תשובה.";
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// ===== הפעלת השרת =====
app.listen(PORT, async ()=>{
  await loadAll();
  console.log(`🍪 קוקישף רצה על פורט ${PORT}`);
});
