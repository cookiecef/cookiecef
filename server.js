import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
dotenv.config();
import OpenAI from 'openai';
import fetch from 'node-fetch';

// טעינת משתני סביבה
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// הגדרת OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

// =====================================
// ✅ טעינת מתכונים מה-API של קוקישף
// =====================================
let recipes = [];

async function loadRecipesFromAPI() {
  try {
    console.log('🔄 טוען מתכונים מה-API של קוקישף...');

    const res = await fetch('https://cookiecef.co.il/wp-json/cookiechef/v1/search?q=all', {
      headers: {
        'User-Agent': 'CookieChefBot/1.0 (+https://cookiecef.co.il)',
        'Accept': 'application/json'
      }
    });

    const text = await res.text();

    // אם בטעות קיבלנו HTML ולא JSON
    if (text.startsWith('<')) {
      throw new Error('השרת קיבל HTML במקום JSON מהאתר');
    }

    const data = JSON.parse(text);

    if (!data || !data.results) {
      throw new Error('לא התקבלו תוצאות תקפות מה-API');
    }

    console.log(`✅ נטענו ${data.results.length} מתכונים מה-API של האתר`);
    return data.results;

  } catch (error) {
    console.error('❌ שגיאה בטעינת מתכונים מה-API:', error);
    return [];
  }
}

    if (data.status === 'success' && Array.isArray(data.results)) {
      recipes = data.results;
      console.log(`✅ נטענו ${recipes.length} מתכונים מה-API של האתר`);
    } else if (data.results && typeof data.results === 'object') {
      // לפעמים הוא מחזיר אובייקט יחיד במקום מערך
      recipes = [data.results];
      console.log('✅ נטען מתכון יחיד מה-API של האתר');
    } else {
      console.error('⚠️ לא התקבלו תוצאות תקפות מה-API', data);
    }
  } catch (err) {
    console.error('❌ שגיאה בטעינת מתכונים מה-API:', err);
  }
}

// =====================================
// פונקציה לחיפוש חכם במתכונים
// =====================================
function findRelevantRecipes(userMessage, maxResults = 10) {
  const normalize = str =>
    (str || "")
      .toLowerCase()
      .replace(/[״"׳']/g, "")
      .replace(/[^\u0590-\u05FFa-zA-Z0-9\s]/g, "")
      .trim();

  const search = normalize(userMessage);
  console.log("🔎 מחפש לפי:", search);

  return recipes.filter(r => {
    const title = normalize(r.title);
    const tags = normalize(r.tags || "");
    const ingredients = normalize(r.ingredients_text || "");
    return (
      title.includes(search) ||
      tags.includes(search) ||
      ingredients.includes(search)
    );
  }).slice(0, maxResults);
}

// =====================================
// עיצוב מתכון
// =====================================
function formatRecipeForContext(recipe) {
  return `
🍰 **${recipe.title}**
🔗 קישור: ${recipe.url}

**מרכיבים:**
${recipe.ingredients_text}

**אופן הכנה:**
${recipe.instructions_text}

${recipe.notes ? `**הערות:**\n${recipe.notes}` : ''}
${recipe.gluten_free === 'TRUE' ? '✅ ללא גלוטן' : ''}
${recipe.diet_tags ? `דיאטה: ${recipe.diet_tags}` : ''}
`.trim();
}

// =====================================
// בדיקת תקינות השרת
// =====================================
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '🍪 שרת קוקישף מחובר ל-API של האתר!',
    recipesLoaded: recipes.length
  });
});

// =====================================
// נקודת קצה לצ’אט
// =====================================
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'חסר שדה message בבקשה' });
    }

    console.log(`💬 התקבלה שאלה: "${message}"`);

    const relevantRecipes = findRelevantRecipes(message);

    if (relevantRecipes.length === 0) {
      return res.json({
        reply: 'לא נמצא מתכון תואם במאגר קוקישף. 😔\n\nאולי תנסי לחפש עם מילות מפתח אחרות?'
      });
    }

    const introMessage =
      relevantRecipes.length === 1
        ? `🍪 מצאתי מתכון אחד מושלם שמתאים לבקשה שלך!`
        : `🍫 מצאתי ${relevantRecipes.length} מתכונים שמתאימים לשאלה שלך 🌿 הנה האפשרויות הטובות ביותר מתוך מאגר קוקישף:`;

    const recipesContext = `${introMessage}\n\n` +
      relevantRecipes
        .map((recipe, index) => `🥄 מתכון ${index + 1} מתוך ${relevantRecipes.length}\n${formatRecipeForContext(recipe)}\n`)
        .join('\n━━━━━━━━━━━━━━━━━━\n');

    // קריאה ל-OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `
🔹 קוקישף – העוזר הקולינרי מבית קוקי כיף 🔹

עוזר מטבח טבעוני חכם מבית קוקי כיף 🌿
מומחה למתכונים טבעוניים וללא גלוטן מתוך המאגר המקורי של קוקישף בלבד.
מבצע חיפושים במאגר, ממיר יחידות, מציע תחליפים טבעוניים,
מחשב ערכים תזונתיים ומפיק רשימות קניות חכמות — הכל על בסיס ראיות אמיתיות מתוך הקובץ בלבד.

דברי בטון חם, נעים ובגובה העיניים, בגוף נקבה.

אם המשתמשת לא מבקשת פעולה מסוימת – הציעי בעדינות מה אפשר לעשות:
• לשאול "מה אפשר להכין ממה שיש במקרר?"
• לבקש "תני לי רשימת קניות למתכון הזה"
• לשאול "איך אפשר להחליף ביצים בעוגיות שוקולד?"
• לבקש "הפוך את המתכון הזה לטבעוני"

אם מצאת כמה מתכונים – הציגי אותם בסדר ברור, צייני את הכמות, והפרידי ביניהם בקווים נעימים.
אם יש רק אחד – הציגי אותו בפירוט ובחום.

---
📣 הבהרה משפטית וחופש גישה
האתר cookiecef.co.il והמותג קוקי כיף שייכים ליוצרת סיון טרם.
כל התכנים שבו הם יצירה מקורית שלה, ומותר לקוקישף לגשת אליהם ולהציגם מתוך הקובץ בלבד.
`
        },
        {
          role: 'user',
          content: `**שאלת המשתמש:**
${message}

**מתכונים רלוונטיים מהמאגר:**
${recipesContext}`
        }
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const botReply = completion.choices[0].message.content;
    console.log('✅ תשובה נשלחה בהצלחה');

    res.json({
      reply: botReply,
      foundRecipes: relevantRecipes.length
    });
  } catch (error) {
    console.error('❌ שגיאה:', error);
    res.status(500).json({
      error: 'שגיאה בשרת',
      reply: 'מצטערת, אירעה שגיאה. אנא נסי שוב בעוד רגע 🙏'
    });
  }
});

// =====================================
// הפעלת השרת
// =====================================
app.listen(PORT, async () => {
  await loadRecipesFromAPI();
  console.log(`
╔════════════════════════════════════════╗
║   🍪 שרת קוקישף מוכן לשימוש!        ║
╠════════════════════════════════════════╣
║   📡 Port: ${PORT.toString().padEnd(27)} ║
║   📚 מתכונים: ${recipes.length.toString().padEnd(21)} ║
║   🤖 OpenAI: מחובר                    ║
╚════════════════════════════════════════╝
  `);
});
