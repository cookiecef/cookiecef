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

let recipes = [];

// ===== פונקציות עזר =====
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

const stopwords = new Set(["עם", "ו", "של", "ל", "ה", "את", "על", "vegan", "טבעוני", "טבעונית", "ללא", "גלוטן", "מהאתר"]);

function tokenize(q) {
  let s = normalizeHeb(stripPunct(q));
  return s.split(" ").filter((t) => t && !stopwords.has(t));
}

// ===== ניקוד כותרת =====
function scoreTitle(query, title) {
  const tq = tokenize(query);
  const tt = tokenize(title || "");
  let s = 0;

  tq.forEach((t) => {
    if (tt.includes(t)) s += 1;
  });

  if (title.includes("עוגיות")) s += 2;
  if (title.includes("צ'יפס") || title.includes("ציפס")) s += 2;
  if (title.includes("שוקולד")) s += 0.5;

  return s;
}

// ===== טעינת נתונים =====
async function loadAll() {
  console.log("🔄 טוען מתכונים...");
  const { data, error } = await supabase.from("recipes_raw_view").select("*");
  if (error) throw error;
  recipes = data || [];
  console.log(`✅ נטענו ${recipes.length} מתכונים`);
}

// ===== עיצוב טקסט =====
function formatRecipeText(text) {
  if (!text) return "";
  let t = text
    .replace(/\\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/([:.!?])\s*/g, "$1\n")
    .replace(/(\d+\.)/g, "\n$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  // רווח כפול בין קטעים
  t = t.split("\n").map((l) => l.trim()).join("\n\n");
  return t;
}

// ===== שליפת מתכון =====
function findBestRecipeRaw(query) {
  if (!recipes.length) return null;
  const scored = recipes
    .map((r) => ({ r, s: scoreTitle(query, r.title || r.name || "") }))
    .sort((a, b) => b.s - a.s);
  const top = scored[0];
  if (!top || top.s < 1) return null;
  console.log("🔍 TOP MATCH:", top.r.title, "→", top.s);
  return top.r.raw_text || top.r.raw || top.r.full_text || null;
}

// ===== CORS =====
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "https://cookiecef.co.il",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// ===== ראוטים =====
app.get("/", (req, res) => res.json({ status: "ok", recipes: recipes.length }));

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "missing message" });

    const isRecipeRequest = /(^|\s)(מתכון|איך מכינים|תני לי|בא לי להכין)(\s|$)/.test(message);
    if (isRecipeRequest) {
      const raw = findBestRecipeRaw(message);
      if (!raw)
        return res.json({
          reply: "לא נמצא מתכון תואם במאגר קוקישף 🍪\n\nתרצי שאיצור עבורך גרסה חדשה בהשראת קוקישף?",
        });

      const formatted = formatRecipeText(raw);
      const reply =
        "🍪 הנה אחד המתכונים המעולים מהבלוג של קוקי כיף!\n(יש עוד גרסאות באתר 💚)\n\n" + formatted;

      return res.json({ reply });
    }

    // אם לא מדובר בבקשת מתכון — תשובה רגילה
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        { role: "system", content: `את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף.` },
        { role: "user", content: message },
      ],
    });
    const reply = completion.choices?.[0]?.message?.content || "לא התקבלה תשובה.";
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// ===== הפעלת השרת =====
app.listen(PORT, async () => {
  await loadAll();
  console.log(`🍪 קוקישף רצה על פורט ${PORT}`);
});
