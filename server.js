// === קוקישף SERVER מעודכן (מצרכים + מספור תקין) ===
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
let subs = [];
let nutrition = [];
let units = [];
let veganLookup = [];
let masterList = [];
let pricebook = [];
let mealPrep = [];

const normalizeHeb = (s) =>
  s.replace(/[״”“„]/g, '"')
   .replace(/[׳’‘`]/g, "'")
   .replace(/[ך]/g, "כ").replace(/[ם]/g, "מ").replace(/[ן]/g, "נ").replace(/[ף]/g, "פ").replace(/[ץ]/g, "צ")
   .toLowerCase();

function jaccard(a,b){const A=new Set(a),B=new Set(b);const inter=[...A].filter(x=>B.has(x)).length;const uni=new Set([...A,...B]).size;return uni?inter/uni:0;}
function tokenize(q){return normalizeHeb(q).split(/\s+/).filter(Boolean);}

function scoreTitle(query,title){
  const s=jaccard(tokenize(query),tokenize(title||""));
  return title.includes("שוקולד")?s+0.3:s;
}

async function loadAll(){
  console.log("🔄 טוען נתונים מ־Supabase...");
  const {data}=await supabase.from("recipes_raw_view").select("*");
  recipes=data||[];
  console.log(`✅ נטענו ${recipes.length} מתכונים`);
}

// === עיצוב HTML נקי ===
function formatRecipeHTML(text){
  if(!text) return "";
  let t=text.replace(/\\n/g,"\n").replace(/\r/g,"").replace(/קודם\s*הבא/gi,"").trim();

  const parts={title:"",ingredients:"",steps:"",notes:""};
  let section="title";
  for(const l of t.split(/\n+/)){
    if(/מרכיבים|מצרכים|🧾/.test(l)) {section="ingredients";continue;}
    if(/אופן הכנה|👩‍🍳/.test(l)) {section="steps";continue;}
    if(/הערות/.test(l)) {section="notes";continue;}
    parts[section]+=l.trim()+"\n";
  }

  // 🥣 מצרכים – שורה לכל רכיב אמיתי (נזהר שלא לשבור מידי)
  const ingredientsHTML = parts.ingredients
    .split(/\n+/)
    .map(l=>l.trim())
    .filter(l=>l && l.length>2)
    .map(l=>`<li>${l}</li>`)
    .join("");

  // 👩‍🍳 אופן הכנה – רק מספור אחד
  const stepsHTML = parts.steps
    .replace(/\*\*/g,"")
    .split(/\n+\s*(?=\d+\.)/)
    .map(l=>l.replace(/^\s*\d+\.\s*/,"").trim())
    .filter(Boolean)
    .map(l=>`<li>${l}</li>`)
    .join("");

  const notesHTML = parts.notes
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .map(n=>`<li>${n}</li>`)
    .join("");

  const title = (parts.title||"")
    .replace(/^🍰\s*/,"")
    .replace(/\s{2,}/g," ")
    .trim();

  return `
  <div style="direction:rtl;text-align:right;font-family:'Assistant',sans-serif;line-height:1.8;color:#4a2c06;background:#fffaf4;padding:20px;border-radius:12px;">
    <p style="margin:0 0 10px 0;">🍪 הנה אחד המתכונים המעולים מהבלוג של קוקי כיף!<br>(יש עוד גרסאות באתר 💚)</p>
    ${title?`<h2 style="margin:4px 0 12px 0;">${title}</h2>`:""}

    <h3 style="margin:10px 0 6px 0;">🧾 מצרכים</h3>
    <ul style="margin:0 0 12px 0;padding-inline-start:20px;">${ingredientsHTML}</ul>

    <h3 style="margin:10px 0 6px 0;">👩‍🍳 אופן הכנה</h3>
    <ol style="margin:0;padding-inline-start:20px;">${stepsHTML}</ol>

    ${notesHTML?`<h3 style="margin:12px 0 6px 0;">📌 הערות והמרות</h3>
    <ul style="margin:0;padding-inline-start:20px;">${notesHTML}</ul>`:""}
  </div>`;
}

function findBestRecipeRaw(query){
  if(!recipes.length) return null;
  const scored=recipes.map(r=>({r,s:scoreTitle(query,r.title)})).sort((a,b)=>b.s-a.s);
  const top=scored[0];
  if(!top||top.s<0.1) return null;
  const raw=top.r.raw_text||top.r.raw||top.r.full_text;
  return raw?String(raw):null;
}

// === CORS & ROUTES ===
app.use(cors({origin:"https://cookiecef.co.il"}));
app.use(express.json());

app.get("/",(req,res)=>res.json({status:"ok"}));

app.post("/chat",async(req,res)=>{
  try{
    const {message}=req.body||{};
    const m=message.trim();
    const isRecipe=/מתכון|איך מכינים|תני לי|בא לי להכין/.test(m);
    if(isRecipe){
      const raw=findBestRecipeRaw(m);
      if(!raw) return res.json({reply:"<p>לא נמצא מתכון תואם במאגר קוקישף 🍪</p>"});
      const html=formatRecipeHTML(raw);
      return res.json({reply:html});
    }
    const completion=await openai.chat.completions.create({
      model:"gpt-4o-mini",
      temperature:0.4,
      max_tokens:900,
      messages:[
        {role:"system",content:"את קוקישף 🍪 — עוזרת קולינרית טבעונית מבית קוקי כיף."},
        {role:"user",content:m}
      ]
    });
    res.json({reply:completion.choices[0].message.content});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"internal error"});
  }
});

app.listen(PORT,async()=>{await loadAll();console.log(`🍪 קוקישף רצה על פורט ${PORT}`);});
