"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

// ── Schema ───────────────────────────────────────────────────────────────────

export async function ensureSettingsTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS fund_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    INSERT INTO fund_config (key, value)
    VALUES ('brokerage_fee_pct', '2.0')
    ON CONFLICT (key) DO NOTHING;
  `;
  // bonus_payments is a log table — actual balance impact is via ledger inserts
  await sql`
    CREATE TABLE IF NOT EXISTS bonus_payments (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
      ledger_type TEXT NOT NULL,    -- 'equity' | 'fixed_savings'
      source_id   UUID,             -- id of the record in capital_ledger / fixed_savings_ledger
      amount      NUMERIC(15, 4) NOT NULL,
      date        DATE NOT NULL,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  // add source_id column if this table already existed without it
  await sql`
    ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS source_id UUID;
  `;
}

// ── Fund Config ───────────────────────────────────────────────────────────────

export async function getBrokerageFeeRate(): Promise<number> {
  await ensureSettingsTables();
  const res = await sql`SELECT value FROM fund_config WHERE key = 'brokerage_fee_pct'`;
  return parseFloat(res.rows[0]?.value ?? "2.0");
}

export async function updateBrokerageFeeRate(formData: FormData) {
  const rateStr = formData.get("brokerage_fee_pct")?.toString();
  if (!rateStr) return { error: "Rate is required" };
  const rate = parseFloat(rateStr);
  if (isNaN(rate) || rate < 0 || rate > 100) return { error: "Rate must be between 0 and 100" };

  await ensureSettingsTables();
  await sql`
    INSERT INTO fund_config (key, value, updated_at)
    VALUES ('brokerage_fee_pct', ${rate.toString()}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  revalidatePath("/settings");
  return { success: true };
}

// ── Bonus Payments ────────────────────────────────────────────────────────────

export async function getAllBonusPayments() {
  await ensureSettingsTables();
  const res = await sql`
    SELECT
      bp.id,
      bp.investor_id,
      COALESCE(i.name, 'All Investors') as investor_name,
      bp.ledger_type,
      bp.amount,
      TO_CHAR(bp.date, 'YYYY-MM-DD') as date,
      bp.notes,
      bp.created_at
    FROM bonus_payments bp
    LEFT JOIN investors i ON bp.investor_id = i.id
    ORDER BY bp.created_at DESC;
  `;
  return res.rows;
}

export async function getBonusByInvestor(investorId: string) {
  await ensureSettingsTables();
  const res = await sql`
    SELECT id, ledger_type, amount,
           TO_CHAR(date, 'YYYY-MM-DD') as date, notes
    FROM bonus_payments
    WHERE investor_id = ${investorId}
    ORDER BY date DESC;
  `;
  return res.rows;
}

// Helper: insert one bonus into the correct ledger + log in bonus_payments
async function insertBonusRecord(
  investorId: string,
  ledgerType: "equity" | "fixed_savings",
  amount: number,
  date: string,
  notes: string,
) {
  if (ledgerType === "equity") {
    const r = await sql`
      INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
      VALUES (${investorId}, ${date}, 'Bonus', ${amount}, ${notes})
      RETURNING id
    `;
    const sourceId = r.rows[0]?.id;
    await sql`
      INSERT INTO bonus_payments (investor_id, ledger_type, source_id, amount, date, notes)
      VALUES (${investorId}, 'equity', ${sourceId}, ${amount}, ${date}, ${notes})
    `;
  } else {
    // fixed_savings bonus has NO interest rate — it's a flat bonus, doesn't accrue
    const r = await sql`
      INSERT INTO fixed_savings_ledger (investor_id, date, type, amount, notes)
      VALUES (${investorId}, ${date}, 'Bonus', ${amount}, ${notes})
      RETURNING id
    `;
    const sourceId = r.rows[0]?.id;
    await sql`
      INSERT INTO bonus_payments (investor_id, ledger_type, source_id, amount, date, notes)
      VALUES (${investorId}, 'fixed_savings', ${sourceId}, ${amount}, ${date}, ${notes})
    `;
  }
}

export async function addBonusPayment(formData: FormData) {
  const targetType  = formData.get("target_type")?.toString() as "specific" | "all";
  const investorId  = formData.get("investor_id")?.toString();
  const ledgerType  = formData.get("ledger_type")?.toString() as "equity" | "fixed_savings";
  const amountStr   = formData.get("amount")?.toString();
  const date        = formData.get("date")?.toString();
  const notes       = formData.get("notes")?.toString() || "";

  if (!targetType || !ledgerType || !amountStr || !date) {
    return { error: "Missing required fields" };
  }
  const totalAmount = parseFloat(amountStr);
  if (isNaN(totalAmount) || totalAmount <= 0) return { error: "Amount must be positive" };

  await ensureSettingsTables();

  try {
    if (targetType === "specific") {
      if (!investorId) return { error: "Please select an investor" };
      await insertBonusRecord(investorId, ledgerType, totalAmount, date, notes || "Special bonus");
    } else {
      // Distribute proportionally to all investors
      const sourceTable = ledgerType === "equity" ? "capital_ledger" : "fixed_savings_ledger";
      const rows = await sql.query(
        `SELECT investor_id,
                SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount WHEN type = 'Withdrawal' THEN -amount ELSE 0 END) as net
         FROM ${sourceTable}
         GROUP BY investor_id
         HAVING SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount WHEN type = 'Withdrawal' THEN -amount ELSE 0 END) > 0`,
      );
      const totalNet = rows.rows.reduce((s: number, r: any) => s + parseFloat(r.net), 0);
      if (totalNet <= 0) return { error: "No balance found to distribute to" };

      for (const r of rows.rows) {
        const share = parseFloat(r.net) / totalNet;
        const investorBonus = totalAmount * share;
        if (investorBonus > 0.001) {
          await insertBonusRecord(
            r.investor_id,
            ledgerType,
            investorBonus,
            date,
            notes || (ledgerType === "equity" ? "Proportional equity bonus" : "Proportional savings bonus"),
          );
        }
      }
    }

    revalidatePath("/settings");
    revalidatePath("/investors");
    revalidatePath("/reports");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to add bonus payment." };
  }
}

export async function deleteBonusPayment(id: string) {
  await ensureSettingsTables();
  try {
    // Get source_id and ledger_type to delete from the correct ledger
    const log = await sql`
      SELECT source_id, ledger_type FROM bonus_payments WHERE id = ${id}
    `;
    if (log.rows.length > 0) {
      const { source_id, ledger_type } = log.rows[0];
      if (source_id) {
        if (ledger_type === "equity") {
          await sql`DELETE FROM capital_ledger WHERE id = ${source_id} AND type = 'Bonus'`;
        } else {
          await sql`DELETE FROM fixed_savings_ledger WHERE id = ${source_id} AND type = 'Bonus'`;
        }
      }
    }
    await sql`DELETE FROM bonus_payments WHERE id = ${id}`;
    revalidatePath("/settings");
    revalidatePath("/investors");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to delete bonus." };
  }
}
