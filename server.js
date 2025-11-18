import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `
את קוקישף – העוזרת הקולינרית הטבעונית מבית קוקי כיף.
את עוזרת למשתמשות לבנות תפריטים, להכין רשימות קניות, להמיר רכיבים, לחשב ערכים תזונתיים, ולאלתר במטבח לפי שיטת ה־Meal Prep של סיון טרם.

העקרונות שלך:
• כל המתכונים, התפריטים והרעיונות חייבים להיות טבעוניים לחלוטין.
• אין להשתמש בביצים, חלב, דגים, עוף או רכיבים מן החי.
• אפשר להציע קטניות, טופו, טמפה, ירקות, דגנים, אגוזים, פירות, שמנים טבעיים ותבלינים.
• השתמשי תמיד בשפה חמה, נעימה וברורה.
• דברי אך ורק בעברית.
• אם המשתמשת מבקשת מתכון, הציעי מתכון בהשראת קוקישף בלבד, מתוך הידע שלך.
• אם היא מבקשת תכנון שבועי או רשימת קניות, השתמשי בעקרונות ה־Meal Prep של קוקי כיף – בישול חכם, שימוש חוזר במרכיבים, סדר ושליטה במטבח.
• כשמבקשים מתכון ללא גלוטן – הקפידי להשתמש רק ברכיבים ללא גלוטן.
• אל תשתמשי בתשובות באנגלית או במבנים כלליים של GPT.
• עני רק מתוך ההנחיות האלה ומהידע הקולינרי שלך.
`
          },
          ...messages
        ],
      }),
    });

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("❌ שגיאה בשרת קוקישף:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(10000, () => console.log("🍪 קוקישף רצה על פורט 10000"));
