import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fetch from 'node-fetch';

// טעינת משתני סביבה
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// הגדרת OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

let recipes = [];

// === פונקציה לטעינת מתכונים מהאתר שלך ===
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

// === פונקציה לעיצוב מתכון לתצוגה יפה ===
function formatRecipe(recipe) {
  return `
🍰 ${recipe.title}
🔗 ${recipe.url || '—'}

🧾 מרכיבים:
${recipe.ingredients_text || '—'}

👩‍🍳 אופן הכנה:
${recipe.instructions_text || '—'}

${recipe.notes ? `💡 הערות:\n${recipe.notes}` : ''}
${recipe.gluten_free === 'TRUE' ? '✅ ללא גלוטן' : ''}
${recipe.diet_tags ? `🥦 תגיות תזונה: ${recipe.diet_tags}` : ''}
`.trim();
}

// === נקודת בדיקה בסיסית ===
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '🍪 שרת קוקישף מחובר ל-API של האתר!',
    recipesLoaded: recipes.length
  });
});

// === נקודת צ'אט ראשית ===
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'חסר שדה message בבקשה.' });
    }

    console.log(`💬 שאלה מהמשתמשת: ${message}`);

    // חיפוש מתכונים רלוונטיים
    const relevant = recipes.filter(r => {
      const q = message.toLowerCase();
      return (
        r.title?.toLowerCase().includes(q) ||
        r.tags?.toString().toLowerCase().includes(q) ||
        r.ingredients_text?.toLowerCase().includes(q)
      );
    });

    if (relevant.length === 0) {
      return res.json({
        reply: 'לא נמצא מתכון תואם במאגר קוקישף 😔\n\nאולי תנסי לחפש שוב במילים אחרות?'
      });
    }

    const recipesContext = relevant
      .slice(0, 5)
      .map((r, i) => `🥣 מתכון ${i + 1}:\n${formatRecipe(r)}`)
      .join('\n━━━━━━━━━━━━━━━━━━\n');

    // בקשה ל-OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `
את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף.
דברי בטון חם, נעים ובגובה העיניים.
הסתמכי רק על המתכונים שנשלחו אלייך מהמאגר.
אם לא נמסר מידע מדויק — אל תמציאי.
`
        },
        {
          role: 'user',
          content: `שאלה: ${message}\n\nמתכונים רלוונטיים:\n${recipesContext}`
        }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const reply = completion.choices[0].message.content;
    console.log('✅ נשלחה תשובה מהבוט');

    res.json({ reply, found: relevant.length });

  } catch (error) {
    console.error('❌ שגיאה בשרת:', error);
    res.status(500).json({ error: 'שגיאה פנימית', reply: 'מצטערת, אירעה תקלה זמנית 😔' });
  }
});

// === הפעלת השרת ===
app.listen(PORT, async () => {
  recipes = await loadRecipesFromAPI();

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
