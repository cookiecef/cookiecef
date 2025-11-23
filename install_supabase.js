import { execSync } from 'child_process';

try {
  console.log('📦 מתקין את ספריית Supabase...');
  execSync('npm install @supabase/supabase-js', { stdio: 'inherit' });
  console.log('✅ Supabase הותקן בהצלחה!');
} catch (err) {
  console.error('❌ שגיאה בהתקנת Supabase:', err);
  process.exit(1);
}
