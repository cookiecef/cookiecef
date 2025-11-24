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

// ניקוי טקסט
function cleanText(t) {
  return t.replace(/\\n/g, "\n").replace(/\r/g, "").replace(/קודם\s*הבא/gi, "").trim();
}

// חילוץ חלקים לפי מילות מפתח
function splitSections(raw) {
  const parts = { title: "", ingredients: "", steps: "", notes: "" };
  let section = "title";
  const lines = cleanText(raw).split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (/מצרכים|מרכיבים|🧾/.test(l)) { section = "ingredients"; continue; }
    if (/אופן הכנה|שלבי הכנה|👩‍🍳/.test(l)) { section = "steps"; continue; }
    if (/הערות|המרות|טיפים/.test(l)) { section = "notes"; continue; }
    parts[section] += l + "\n";
  }
  return parts;
}

// יצירת HTML
function formatRecipeHTML(raw) {
  if (!raw) return "";
  const parts = splitSections(raw);

  const ingredients = parts.ingredients
    .split(/\s+/)
    .filter(w => w.length > 1)
    .join(" ")
    .split(/(?=\d|\*|כוס|גרם|כפות|כפית|מ״ל)/)
    .map(l => l.trim())
    .filter(Boolean);
  const ingredientsHTML = ingredients.map(i => `<li>${i}</li>`).join("");

  const steps = parts.steps
    .replace(/\*\*/g, "")
    .split(/\d+\./)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => `<li>${s}</li>`)
    .join("");

  const notes = parts.notes
    .split(/(?<=[.!?])\s+/)
    .map(n => `<li>${n.trim()}</li>`)
    .join("");

  const title = (parts.title || "").replace(/^🍰\s*/, "").trim();

  return `
  <div style="direction:rtl;text-align:right;font-family:'Assistant',sans-serif;line-height:1.8;color:#4a2c06;background:#fffaf4;padding:20px;border-radius:12px;">
    <p>🍪 הנה אחד המתכונים המעולים מהבלוג של קוקי כיף!<br>(יש עוד גרסאות באתר 💚)</p>
    ${title ? `<h2>${title}</h2>` : ""}
    <h3>🧾 מצרכים</h3><ul>${ingredientsHTML}</ul>
    <h3>👩‍🍳 אופן הכנה</h3><ol>${steps}</ol>
    ${notes ? `<h3>📌 הערות והמרות</h3><ul>${notes}</ul>` : ""}
  </div>`;
}

function findBestRecipeRaw(query) {
  if (!recipes.length) return null;
  const lower = query.toLowerCase();
  const match = recipes.find(r => (r.title || "").toLowerCase().includes(lower));
  const raw = match ? match.raw_text || match.raw || match.full_text : null;
  return raw ? String(raw) : null;
}

async function loadAll() {
  const { data, error } = await supabase.from("recipes_raw_view").select("*");
  if (error) console.error("❌ שגיאה בטעינה:", error.message);
  recipes = data || [];
  console.log(`✅ נטענו ${recipes.length} מתכונים`);
}

app.use(cors({ origin: "https://cookiecef.co.il" }));
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "ok" }));

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    const m = message.trim();
    const isRecipe = /מתכון|איך מכינים|תני לי|בא לי להכין/.test(m);

    if (isRecipe) {
      const raw = findBestRecipeRaw(m);
      if (!raw)
        return res.json({ reply: "<p>לא נמצא מתכון תואם במאגר קוקישף 🍪</p>" });
      return res.json({ reply: formatRecipeHTML(raw) });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        { role: "system", content: "את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף." },
        { role: "user", content: m }
      ]
    });

    res.json({ reply: completion.choices?.[0]?.message?.content || "לא התקבלה תשובה." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.listen(PORT, async () => {
  await loadAll();
  console.log(`🍪 קוקישף רצה על פורט ${PORT}`);
});
