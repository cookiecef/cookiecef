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

// ===============================
// 🔧 פונקציות עזר לטיפול בעברית
// ===============================

// נרמול טקסט עברי - מטפל בגרשיים, אותיות סופיות, רווחים
function normalizeHebrew(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[׳'`´]/g, "'")  // אחדת כל הגרשיים
    .replace(/[״""]/g, '"')   // אחדת גרשיים כפולים
    .replace(/[םמ]/g, "מ")    // אותיות סופיות
    .replace(/[ןנ]/g, "נ")
    .replace(/[ץצ]/g, "צ")
    .replace(/[ךכ]/g, "כ")
    .replace(/[ףפ]/g, "פ")
    .replace(/\s+/g, " ")     // רווחים מרובים לרווח אחד
    .trim();
}

// חישוב ציון דמיון בין שני טקסטים (0-100)
function calculateSimilarity(str1, str2) {
  const s1 = normalizeHebrew(str1);
  const s2 = normalizeHebrew(str2);
  
  // התאמה מלאה
  if (s1 === s2) return 100;
  
  // התאמה חלקית
  if (s1.includes(s2) || s2.includes(s1)) return 80;
  
  // מילות מפתח משותפות
  const words1 = s1.split(" ").filter(w => w.length > 2);
  const words2 = s2.split(" ").filter(w => w.length > 2);
  const commonWords = words1.filter(w => words2.includes(w));
  
  if (commonWords.length === 0) return 0;
  
  const score = (commonWords.length / Math.max(words1.length, words2.length)) * 70;
  return Math.round(score);
}

// ===============================
// 🔍 חיפוש מתכון משופר
// ===============================

function findBestRecipeRaw(query) {
  if (!recipes.length) {
    console.log("⚠️ אין מתכונים בזיכרון");
    return null;
  }

  const normalizedQuery = normalizeHebrew(query);
  console.log(`🔍 מחפש: "${query}" → נרמול: "${normalizedQuery}"`);

  // שלב 1: חיפוש התאמה מדויקת (אחרי נרמול)
  let exactMatch = recipes.find(r => {
    const title = normalizeHebrew(r.title || "");
    return title === normalizedQuery;
  });
  
  if (exactMatch) {
    console.log(`✅ התאמה מדויקת: ${exactMatch.title}`);
    return exactMatch.raw_text || exactMatch.raw || exactMatch.full_text || null;
  }

  // שלב 2: חיפוש כוללני (contains)
  let partialMatch = recipes.find(r => {
    const title = normalizeHebrew(r.title || "");
    return title.includes(normalizedQuery) || normalizedQuery.includes(title);
  });
  
  if (partialMatch) {
    console.log(`✅ התאמה חלקית: ${partialMatch.title}`);
    return partialMatch.raw_text || partialMatch.raw || partialMatch.full_text || null;
  }

  // שלב 3: חיפוש מילות מפתח (fuzzy)
  const matches = recipes
    .map(r => ({
      recipe: r,
      score: calculateSimilarity(r.title || "", query)
    }))
    .filter(m => m.score >= 40)  // סף מינימלי של 40%
    .sort((a, b) => b.score - a.score);

  if (matches.length > 0) {
    const best = matches[0];
    console.log(`✅ התאמה חכמה (${best.score}%): ${best.recipe.title}`);
    return best.recipe.raw_text || best.recipe.raw || best.recipe.full_text || null;
  }

  console.log("❌ לא נמצא מתכון תואם");
  return null;
}

// ===============================
// 📝 עיבוד וניקוי טקסט
// ===============================

function cleanText(t) {
  return t.replace(/\\n/g, "\n").replace(/\r/g, "").replace(/קודם\s*הבא/gi, "").trim();
}

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

// ===============================
// 🗄️ טעינת מתכונים מ-Supabase
// ===============================

async function loadAll() {
  console.log("⏳ טוען מתכונים מ-Supabase...");
  const { data, error } = await supabase.from("recipes_raw_view").select("*");
  
  if (error) {
    console.error("❌ שגיאה בטעינה:", error.message);
    return;
  }
  
  recipes = data || [];
  console.log(`✅ נטענו ${recipes.length} מתכונים`);
  
  // הצג דוגמאות של כותרות (לבדיקה)
  if (recipes.length > 0) {
    console.log("📋 דוגמאות כותרות:");
    recipes.slice(0, 3).forEach(r => console.log(`   - ${r.title}`));
  }
}

// ===============================
// 🌐 API Routes
// ===============================

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
    
    const isRecipe = /מתכון|איך מכינים|תני לי|בא לי להכין|רוצה להכין/.test(m);

    if (isRecipe) {
      const raw = findBestRecipeRaw(m);
      
      if (!raw) {
        return res.json({ 
          reply: `<div style="direction:rtl;padding:15px;background:#fff3e0;border-radius:8px;">
            <p>🔍 לא מצאתי מתכון שתואם בדיוק ל: <strong>${m}</strong></p>
            <p>נסי לחפש במילים אחרות או תשאלי אותי משהו אחר! 💚</p>
          </div>` 
        });
      }
      
      return res.json({ reply: formatRecipeHTML(raw) });
    }

    // שאלות כלליות - שולח ל-GPT
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

// ===============================
// 🚀 הפעלת השרת
// ===============================

app.listen(PORT, async () => {
  console.log(`🚀 שרת מתחיל על פורט ${PORT}...`);
  await loadAll();
  console.log(`🍪 קוקישף רץ ומוכן! https://cookiecef.onrender.com`);
});
```

---

## ✅ כל הקוד - 268 שורות מלאות!

**עכשיו:**
1. **העתיקי את כל הקוד** (מהשורה הראשונה עד האחרונה)
2. **GitHub** → פתחי את `server.js`
3. **Edit** → **Ctrl+A** (בחירת הכל) → **Delete**
4. **הדביקי את הקוד החדש**
5. **Commit changes**

אחרי זה Render יעשה deploy אוטומטי ותראי בלוגים:
```
🚀 שרת מתחיל על פורט 10000...
⏳ טוען מתכונים מ-Supabase...
✅ נטענו 269 מתכונים
📋 דוגמאות כותרות:
   - עוגיות שוקולד צ'יפס טבעוניות
🍪 קוקישף רץ ומוכן!
