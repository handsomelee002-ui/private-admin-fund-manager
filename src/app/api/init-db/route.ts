import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // 1. Investors Table
    await sql`
      CREATE TABLE IF NOT EXISTS investors (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 2. Capital Ledger Table
    await sql`
      CREATE TABLE IF NOT EXISTS capital_ledger (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        type TEXT CHECK (type IN ('Deposit', 'Withdrawal')),
        amount NUMERIC(15, 2) NOT NULL,
        notes TEXT,
        receipt_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 3. Trading Ledger Table
    await sql`
      CREATE TABLE IF NOT EXISTS trading_ledger (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        date DATE NOT NULL,
        platform TEXT NOT NULL,
        ticker TEXT NOT NULL,
        type TEXT CHECK (type IN ('Buy', 'Sell')),
        currency TEXT NOT NULL,
        price NUMERIC(15, 4) NOT NULL,
        quantity NUMERIC(15, 4) NOT NULL,
        amount_rm NUMERIC(15, 2) NOT NULL,
        profit_loss NUMERIC(15, 2),
        date_closed DATE,
        receipt_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 4. Cash Balances Table
    await sql`
      CREATE TABLE IF NOT EXISTS cash_balances (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        account_name TEXT NOT NULL,
        current_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    return NextResponse.json({ message: 'Database tables initialized successfully.' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
