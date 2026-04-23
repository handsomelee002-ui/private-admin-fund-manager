# Private Admin Fund Manager

A minimal, robust, and beautiful Next.js application designed to help private fund managers record investor capital, log trades, and provide a read-only portal for investors to check their performance.

## Tech Stack
- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS & Shadcn UI (Custom Dark Theme)
- **Database & Backend**: Supabase (PostgreSQL, Auth, Storage)
- **Deployment**: Vercel

## 1. Supabase Setup

Before deploying or running locally, you must set up your database. 

1. Create a new project at [Supabase](https://supabase.com/).
2. Navigate to the **SQL Editor** in your Supabase dashboard and run the following script:

```sql
-- 1. Investors Table
CREATE TABLE investors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Capital Ledger Table
CREATE TABLE capital_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type TEXT CHECK (type IN ('Deposit', 'Withdrawal')),
  amount NUMERIC(15, 2) NOT NULL,
  notes TEXT,
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Trading Ledger Table
CREATE TABLE trading_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  platform TEXT NOT NULL,
  ticker TEXT NOT NULL,
  type TEXT CHECK (type IN ('Buy', 'Sell')),
  currency TEXT NOT NULL,
  price NUMERIC(15, 4) NOT NULL,
  quantity NUMERIC(15, 4) NOT NULL,
  amount_rm NUMERIC(15, 2) NOT NULL,
  profit_loss NUMERIC(15, 2), -- Manual field, only for 'Sell' or closed trades
  date_closed DATE,
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Cash Balances Table
CREATE TABLE cash_balances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_name TEXT NOT NULL,
  current_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

3. Go to **Storage** and create a new public bucket named `receipts`.
4. Go to **Project Settings -> API** and copy your `Project URL` and `anon public` key.

## 2. Environment Variables

Create a `.env.local` file in the root of the project:

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 3. Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 4. Deployment on Vercel

The easiest way to deploy this Next.js app is to use the Vercel Platform.

1. Push your code to a GitHub repository.
2. Go to [Vercel](https://vercel.com/new) and import your repository.
3. In the "Environment Variables" section, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click **Deploy**.

## Authentication Note
Currently, the admin portal relies on obfuscated URLs or standard routing. If you want full role-based access control, we recommend enabling Supabase Auth and restricting access to `/investors`, `/capital`, and `/trading` to only authenticated Admin users. The `/portal/[investor_id]` route can remain open to users with the specific UUID.
