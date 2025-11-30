// Updated: 28.11.2025 - חיבור לטבלת knowledge_base
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
let knowledgeBase = []; // 🆕 מאגר הידע

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

function isRecommendationRequest(text) {
  const lower = text.toLowerCase();
  
  const recommendationPatterns = [
    /\d+\s*מתכונים/,
    /תני\s+לי\s+מתכונים/,
    /המלצ/,
    /רוצה\s+מתכונים/,
    /אפשר\s+מתכונים/,
    /תציע/,
    /מה\s+אפשר/,
    /רעיונות\s+למתכונים/,
    /,.*מתכון/,
  ];
  
  return recommendationPatterns.some(pattern => pattern.test(lower));
}

function isSpecificRecipeRequest(text) {
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

// 🆕 בדיקה אם השאלה קשורה למיל פרפ או flow
function isKnowledgeQuestion(text) {
  const lower = text.toLowerCase();
  
  const knowledgeKeywords = [
    'meal prep', 'מיל פרפ', 'מיילפרפ', 'בישול מראש',
    'סדר בישול', 'flow', 'פלו', 'תכנון בישול',
    'איך לארגן', 'סדר פעולות', 'תזמון',
    'סלט בצנצנת', 'חלבון טבעוני', 'בסיסים',
    'תנור', 'כיריים', 'batching', 'תחנות עבודה'
  ];
  
  return knowledgeKeywords.some(keyword => lower.includes(keyword));
}

// 🆕 חיפוש בטבלת הידע
function searchKnowledge(query) {
  const normalized = normalizeHebrew(query);
  
  // חיפוש לפי מילות מפתח או תוכן
  const matches = knowledgeBase.filter(item => {
    const keywords = normalizeHebrew(item.keywords || '');
    const content = normalizeHebrew(item.content || '');
    const topic = normalizeHebrew(item.topic || '');
    
    return keywords.includes(normalized) || 
           content.includes(normalized) ||
           topic.includes(normalized);
  });
  
  return matches;
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
  <p style="margin-bottom:12px;">🍪 הנה אחד המתכונים המעולים מהבלוג של קוקי כיף!<br>(יש עוד גרסאות באתר 💚)</p>
  <h2 style="margin:12px 0 8px 0;">${title}</h2>
  <h3 style="margin:8px 0 5px 0;">🧾 מצרכים</h3>
  <ul style="margin:0 0 10px 0;padding-right:20px;">
    <li style="margin-bottom:4px;">פריט ראשון</li>
    <li style="margin-bottom:4px;">פריט שני</li>
  </ul>
  <h3 style="margin:8px 0 5px 0;">👩‍🍳 אופן הכנה</h3>
  <ol style="margin:0 0 10px 0;padding-right:20px;">
    <li style="margin-bottom:6px;">שלב ראשון</li>
    <li style="margin-bottom:6px;">שלב שני</li>
  </ol>
  <h3 style="margin:8px 0 5px 0;">📌 הערות והמרות</h3>
  <ul style="margin:0;padding-right:20px;">
    <li style="margin-bottom:6px;">הערה ראשונה</li>
  </ul>
</div>

חשוב:
- כל מצרך בשורה נפרדת ב-<li>
- כל שלב בשורה נפרדת ב-<li>
- אל תוסיף כוכביות או מספרים - רק את התוכן
- אם יש הערות והמרות בטקסט - הוסף אותן בסעיף נפרד
- שמור על הסטיילים בדיוק כמו בדוגמה (במיוחד המרווחים!)
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
  console.log("⏳ טוען נתונים מ-Supabase...");
  
  // טעינת מתכונים
  const { data: recipesData, error: recipesError, count } = await supabase
    .from("recipes_enriched_with_tags_new")
    .select("id, title, ingredients_text, instructions_text", { count: 'exact' })
    .range(0, 1000);
  
  if (recipesError) {
    console.error("❌ שגיאה בטעינת מתכונים:", recipesError.message);
  } else {
    recipes = recipesData || [];
    console.log(`✅ נטענו ${recipes.length} מתכונים (סה"כ במאגר: ${count})`);
  }
  
  // 🆕 טעינת מאגר הידע
  const { data: knowledgeData, error: knowledgeError } = await supabase
    .from("knowledge_base")
    .select("*");
  
  if (knowledgeError) {
    console.error("❌ שגיאה בטעינת knowledge:", knowledgeError.message);
  } else {
    knowledgeBase = knowledgeData || [];
    console.log(`✅ נטען מאגר ידע: ${knowledgeBase.length} פריטים`);
  }
}

app.use(cors({ origin: "https://cookiecef.co.il" }));
app.use(express.json());

app.get("/", (req, res) => res.json({ 
  status: "ok", 
  recipes: recipes.length,
  knowledge: knowledgeBase.length,
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
    
    // 🆕 בדיקה: האם זו שאלה על meal prep / flow?
    if (isKnowledgeQuestion(m)) {
      console.log("📚 זוהה כשאלת ידע - מחפש במאגר");
      
      const knowledgeMatches = searchKnowledge(m);
      
      if (knowledgeMatches.length > 0) {
        // מצאנו מידע רלוונטי - שולחים ל-GPT עם ההקשר
        const context = knowledgeMatches.map(k => k.content).join('\n\n---\n\n');
        
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.4,
          max_tokens: 1200,
          messages: [
            { 
              role: "system", 
              content: `את קוקישף 🍪 — מומחית ל-meal prep ותכנון בישולים טבעוניים.

יש לך גישה למאגר ידע מקצועי על:
- Meal Prep (בישול מראש)
- Production Flow (סדר פעולות בישול)
- תכנון מטבח יעיל

כשעונה על שאלות - השתמשי במידע מההקשר שניתן לך, אבל תני תשובה טבעית, ידידותית ומעשית.`
            },
            { 
              role: "user", 
              content: `הקשר רלוונטי ממאגר הידע:\n\n${context}\n\nשאלת המשתמש: ${m}` 
            }
          ]
        });

        const reply = completion.choices?.[0]?.message?.content || "לא הצלחתי לענות.";
        return res.json({ reply });
      }
    }
    
    // בדיקה: האם זו בקשה להמלצות?
    if (isRecommendationRequest(m)) {
      console.log("💡 זוהה כבקשה להמלצות - שולח ל-GPT");
      
      const recipesList = recipes.slice(0, 50).map(r => r.title).join('\n- ');
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.5,
        max_tokens: 1200,
        messages: [
          { 
            role: "system", 
            content: `את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף.

יש לך גישה למאגר של 269 מתכונים טבעוניים מהבלוג.

כשמבקשים ממך המלצות למתכונים:
- המלצי על מתכונים ספציפיים מהרשימה למטה
- התאימי את ההמלצות לבקשה (ארוחת צהריים/ערב, מרכיב ספציפי, וכו')
- תני 2-4 המלצות מגוונות
- הסבירי בקצרה למה כל מתכון מתאים
- עודדי את המשתמשת לחפש את המתכון המלא (למשל: "כתבי 'מתכון לעוגיות שוקולד'")

רשימת המתכונים הזמינים (50 ראשונים):
- ${recipesList}

עני בטון חם, ידידותי ומעודד!`
          },
          { role: "user", content: m }
        ]
      });

      const reply = completion.choices?.[0]?.message?.content || "לא הצלחתי להמליץ כרגע.";
      return res.json({ reply });
    }
    
    // בדיקה: האם זו בקשה למתכון ספציפי?
    if (isSpecificRecipeRequest(m)) {
      console.log("🔍 זוהה כחיפוש מתכון ספציפי");
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

    // שאלות כלליות
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        { 
          role: "system", 
          content: `את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף. את עונה בעברית, בחום ובידידותיות.

יש לך גישה למאגר של 269 מתכונים טבעוניים ומאגר ידע מקצועי על meal prep ותכנון בישולים.

עני תמיד בטון חם, ידידותי ומעודד!`
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
