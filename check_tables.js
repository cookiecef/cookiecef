import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkAllTables() {
  const tables = [
    'recipes_enriched_with_tags_new',
    'substitutions_clean',
    'nutrition_lookup_v2',
    'vegan_lookup_full',
    'units_densities_lookup_v2',
    'shopping_list_meal_prep_with_recipes',
    'master_list_items',
    'pricebook_master'
  ];

  console.log("🔍 בודק טבלאות ב-Supabase...\n");

  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact' })
        .limit(1);

      if (error) {
        console.log(`❌ ${table}: לא נגיש (${error.message})`);
        continue;
      }

      console.log(`✅ ${table}:`);
      console.log(`   📊 ${count} שורות`);
      
      if (data && data.length > 0) {
        console.log(`   📋 עמודות:`, Object.keys(data[0]).join(', '));
        console.log(`   🔍 דוגמה:`, JSON.stringify(data[0], null, 2));
      }
      console.log('\n');

    } catch (e) {
      console.log(`❌ ${table}: שגיאה - ${e.message}\n`);
    }
  }
}

checkAllTables();
