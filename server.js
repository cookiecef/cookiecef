import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// טעינת משתני סביבה
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// הגדרת OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// חיבור ל-Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Middleware
app.use(cors());
app.use(express.json());

let recipes = [];

/**
 * === טעינת מתכונים מ-Supabase ===
 */
async function loadRecipesFromAPI() {
  try {
    console.log('🔄 טוען מתכונים מ-Supabase...');

    const { data, error } = await supabase
      .from(process.env.SUPABASE_TABLE)
      .select('*');

    if (error) throw error;

    console.log(`✅ נטענו ${data.length} מתכונים מה-Supabase`);
    return data;
  } catch (error) {
    console.error('❌ שגיאה בטעינת מתכונים מ-Supabase:', error.message);
    return [];
  }
}

/**
 * === עיצוב תצוגת מתכון ===
 */
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

/**
 * === בדיקה בסיסית שהשרת רץ ===
 */
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '🍪 שרת קוקישף מחובר ל-Supabase!',
    recipesLoaded: recipes.length
  });
});

/**
 * === נקודת הצ'אט ===
 */
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'חסר שדה message בבקשה.' });
    }

    console.log(`💬 שאלה מהמשתמשת: ${message}`);

    // סינון מתכונים רלוונטיים
    const q = message.toLowerCase();
    const relevant = recipes.filter(r =>
      (r.title && r.title.toLowerCase().includes(q)) ||
      (r.tags && r.tags.toString().toLowerCase().includes(q)) ||
      (r.ingredients_text && r.ingredients_text.toLowerCase().includes(q))
    );

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

    const reply = completion.choices?.[0]?.message?.content || 'לא התקבלה תשובה.';
    console.log('✅ נשלחה תשובה מהבוט');

    res.json({ reply, found: relevant.length });

  } catch (error) {
    console.error('❌ שגיאה בשרת:', error);
    res.status(500).json({ error: 'שגיאה פנימית', reply: 'מצטערת, אירעה תקלה זמנית 😔' });
  }
});

/**
 * === הפעלת השרת ===
 */
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
