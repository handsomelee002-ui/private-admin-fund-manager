const { sql } = require('@vercel/postgres');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

async function main() {
  try {
    console.log("Creating platforms table...");
    await sql`
      CREATE TABLE IF NOT EXISTS platforms (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log("Creating platform_transactions table...");
    await sql`
      CREATE TABLE IF NOT EXISTS platform_transactions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        platform_id UUID REFERENCES platforms(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        type VARCHAR(50) NOT NULL, -- 'Deposit' or 'Withdraw'
        amount DECIMAL(15, 2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log("Creating platform_performance table...");
    await sql`
      CREATE TABLE IF NOT EXISTS platform_performance (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        platform_id UUID REFERENCES platforms(id) ON DELETE CASCADE,
        month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
        unrealized_profit DECIMAL(15, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(platform_id, month)
      );
    `;

    console.log("Database tables created successfully.");
  } catch (error) {
    console.error("Error creating tables:", error);
  }
}

main();
