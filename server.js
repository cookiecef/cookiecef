// Updated: 26.11.2025 - תיקון מרווחים והוספת הערות
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

function normalizeHebrew(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[׳'`´]/g, "'")
    .replace(/[״""]/g, '"')
    .replace(/[םמ]/g, "מ")
    .replace(/[ןנ]/g, "נ")
    .replace(/[ץצ]/g, "צ")
    .replace(/[ךכ]/g, "כ")
    .replace(/[ףפ]/g, "פ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuery(text) {
  return text
    .replace(/^(מתכון\s+(ל|של|עבור|ל-)\s*)/i, "")
    .replace(/^(איך\s+(מכינים|להכין|עושים|לעשות)\s*)/i, "")
    .replace(/^(תני\s+לי\s+(מתכון\s+(ל|של))?\s*)/i, "")
    .replace(/^(בא\s+לי\s+להכין\s*)/i, "")
    .replace(/^(רוצה\s+להכין\s*)/i, "")
    .replace(/^(אפשר\s+מתכון\s+(ל|של)\s*)/i, "")
    .trim();
}

function calculateSimilarity(str1, str2) {
  const s1 = normalizeHebrew(str1);
  const s2 = normalizeHebrew(str2);
  
  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 80;
  
  const words1 = s1.split(" ").filter(w => w.length > 2);
  const words2 = s2.split(" ").filter(w => w.length > 2);
  const commonWords = words1.filter(w => words2.includes(w));
  
  if (commonWords.length === 0) return 0;
  
  const score = (commonWords.length / Math.max(words1.length, words2.length)) * 70;
  return Math.round(score);
}

function isRecipeRequest(text) {
  const lower = text.toLowerCase();
  
  if (/מתכון|איך מכינים|תני לי|בא לי להכין|רוצה להכין|אפשר מתכון/.test(lower)) {
    return true;
  }
  
  const foodKeywords = [
    'עוגיות', 'עוגה', 'לחם', 'חלה', 'פיתה', 'לפתן', 'בורקס',
    'סלט', 'מרק', 'תבשיל', 'קארי', 'פסטה', 'פיצה', 'קיש',
    'עוגת', 'מאפה', 'בייגלה', 'רול', 'טורט', 'מוס', 'קרם',
    'גלידה', 'קינוח', 'ביסקוויט', 'בראוני',
    'חומוס', 'טחינה', 'ממרח', 'דיפ', 'רוטב', 'מיונז'
  ];
  
  return foodKeywords.some(keyword => lower.includes(keyword));
}

function findBestRecipeRaw(query) {
  if (!recipes.length) {
    console.log("⚠️ אין מתכונים בזיכרון");
    return null;
  }

  const cleanedQuery = cleanQuery(query);
  const normalizedQuery = normalizeHebrew(cleanedQuery);
  
  console.log(`🔍 מחפש: "${query}"`);

  let exactMatch = recipes.find(r => {
    const title = normalizeHebrew(r.title || "");
    return title === normalizedQuery;
  });
  
  if (exactMatch) {
    console.log(`✅ התאמה מדויקת: ${exactMatch.title}`);
    return exactMatch;
  }

  let partialMatch = recipes.find(r => {
    const title = normalizeHebrew(r.title || "");
    return title.includes(normalizedQuery) || normalizedQuery.includes(title);
  });
  
  if (partialMatch) {
    console.log(`✅ התאמה חלקית: ${partialMatch.title}`);
    return partialMatch;
  }

  const matches = recipes
    .map(r => ({
      recipe: r,
      score: calculateSimilarity(r.title || "", cleanedQuery)
    }))
    .filter(m => m.score >= 40)
    .sort((a, b) => b.score - a.score);

  if (matches.length > 0) {
    const best = matches[0];
    console.log(`✅ התאמה חכמה (${best.score}%): ${best.recipe.title}`);
    return best.recipe;
  }

  console.log("❌ לא נמצא מתכון תואם");
  return null;
}

async function formatRecipeWithGPT(recipe) {
  const title = recipe.title || "";
  const ingredients = recipe.ingredients_text || "";
  const instructions = recipe.instructions_text || "";
  
  const prompt = `אני נותן לך מתכון טבעוני. תפקידך לארגן אותו בפורמט HTML מסודר.

כותרת: ${title}

מצרכים (טקסט גולמי):
${ingredients}

שלבי הכנה (טקסט גולמי):
${instructions}

החזר HTML בפורמט הבא בדיוק (ללא markdown, ללא \`\`\`):

<div style="direction:rtl;text-align:right;font-family:'Assistant',sans-serif;line-height:1.4;color:#4a2c06;background:#fffaf4;padding:20px;border-radius:12px;">
  <p style="margin-bottom:15px;">🍪 הנה אחד המתכונים המעולים מהבלוג של קוקי כיף!<br>(יש עוד גרסאות באתר 💚)</p>
  <h2 style="margin:15px 0 10px 0;">${title}</h2>
  <h3 style="margin:15px 0 8px 0;">🧾 מצרכים</h3>
  <ul style="margin:0 0 15px 0;padding-right:20px;">
    <li style="margin-bottom:5px;">פריט ראשון</li>
    <li style="margin-bottom:5px;">פריט שני</li>
  </ul>
  <h3 style="margin:15px 0 8px 0;">👩‍🍳 אופן הכנה</h3>
  <ol style="margin:0 0 15px 0;padding-right:20px;">
    <li style="margin-bottom:8px;">שלב ראשון</li>
    <li style="margin-bottom:8px;">שלב שני</li>
  </ol>
  <h3 style="margin:15px 0 8px 0;">📌 הערות והמרות</h3>
  <ul style="margin:0;padding-right:20px;">
    <li style="margin-bottom:8px;">הערה ראשונה</li>
  </ul>
</div>

חשוב:
- כל מצרך בשורה נפרדת ב-<li>
- כל שלב בשורה נפרדת ב-<li>
- אל תוסיף כוכביות או מספרים - רק את התוכן
- אם יש הערות והמרות בטקסט - הוסף אותן בסעיף נפרד
- שמור על הסטיילים בדיוק כמו בדוגמה
- החזר רק HTML, ללא הסבר`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 2000,
      messages: [
        { role: "user", content: prompt }
      ]
    });

    let html = completion.choices?.[0]?.message?.content || "";
    
    html = html.replace(/```html\n?/g, "").replace(/```\n?/g, "").trim();
    
    return html;
    
  } catch (error) {
    console.error("❌ שגיאה בעיבוד עם GPT:", error.message);
    return `<div style="direction:rtl;padding:20px;">
      <h2>${title}</h2>
      <p>שגיאה בטעינת המתכון. נסי שוב!</p>
    </div>`;
  }
}

async function loadAll() {
  console.log("⏳ טוען מתכונים מ-Supabase...");
  
  const { data, error, count } = await supabase
    .from("recipes_enriched_with_tags_new")
    .select("id, title, ingredients_text, instructions_text", { count: 'exact' })
    .range(0, 1000);
  
  if (error) {
    console.error("❌ שגיאה בטעינה:", error.message);
    return;
  }
  
  recipes = data || [];
  console.log(`✅ נטענו ${recipes.length} מתכונים (סה"כ במאגר: ${count})`);
  
  if (recipes.length > 0) {
    console.log("📋 דוגמאות כותרות:");
    recipes.slice(0, 3).forEach(r => console.log(`   - ${r.title}`));
  }
}

app.use(cors({ origin: "https://cookiecef.co.il" }));
app.use(express.json());

app.get("/", (req, res) => res.json({ 
  status: "ok", 
  recipes: recipes.length,
  message: "קוקישף פעיל ומוכן לשימוש 🍪"
}));

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "הודעה ריקה" });
    }
    
    const m = message.trim();
    console.log(`💬 הודעה התקבלה: "${m}"`);
    
    if (isRecipeRequest(m)) {
      const recipe = findBestRecipeRaw(m);
      
      if (!recipe) {
        return res.json({ 
          reply: `<div style="direction:rtl;padding:15px;background:#fff3e0;border-radius:8px;">
            <p>🔍 לא מצאתי מתכון שתואם ל: <strong>${m}</strong></p>
            <p>נסי לחפש במילים אחרות או תשאלי אותי משהו אחר! 💚</p>
          </div>` 
        });
      }
      
      const formattedHTML = await formatRecipeWithGPT(recipe);
      return res.json({ reply: formattedHTML });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        { 
          role: "system", 
          content: "את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף. את עונה בעברית, בחום ובידידותיות." 
        },
        { role: "user", content: m }
      ]
    });

    const reply = completion.choices?.[0]?.message?.content || "לא התקבלה תשובה.";
    res.json({ reply });
    
  } catch (e) {
    console.error("❌ שגיאה:", e.message);
    res.status(500).json({ error: "שגיאה פנימית בשרת" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 שרת מתחיל על פורט ${PORT}...`);
  await loadAll();
  console.log(`🍪 קוקישף רץ ומוכן! https://cookiecef.onrender.com`);
});
