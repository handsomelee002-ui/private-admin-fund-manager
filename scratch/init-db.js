const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const { sql } = require('@vercel/postgres');

async function main() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS fixed_savings_ledger (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('Deposit', 'Withdrawal', 'Interest')),
        amount DECIMAL(15, 2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("Table created successfully");
  } catch (error) {
    console.error("Error creating table:", error);
  } finally {
    process.exit(0);
  }
}
main();
