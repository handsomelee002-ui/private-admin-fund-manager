const { sql } = require('@vercel/postgres');
require('dotenv').config({ path: '.env.local' });

async function migrate() {
  try {
    console.log("Adding position_id column...");
    await sql`ALTER TABLE trading_ledger ADD COLUMN IF NOT EXISTS position_id VARCHAR(255);`;
    
    console.log("Backfilling existing trades...");
    await sql`UPDATE trading_ledger SET position_id = ticker WHERE position_id IS NULL;`;
    
    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

migrate();
