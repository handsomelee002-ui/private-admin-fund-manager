"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { issueUnitsForDeposit, redeemUnitsForWithdrawal } from "@/lib/accounting";
import { writeAuditEvent } from "@/lib/fundDb";
import { requireAdmin } from "@/lib/auth";

let settingsTablesPromise: Promise<void> | null = null;

// ── Schema ───────────────────────────────────────────────────────────────────

async function ensureSettingsTablesUncached() {
  await requireAdmin();
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
  await sql`ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
}

export async function ensureSettingsTables() {
  if (settingsTablesPromise) return settingsTablesPromise;
  settingsTablesPromise = ensureSettingsTablesUncached().catch((error) => {
    settingsTablesPromise = null;
    throw error;
  });
  return settingsTablesPromise;
}

// ── Fund Config ───────────────────────────────────────────────────────────────

export async function getBrokerageFeeRate(): Promise<number> {
  await requireAdmin();
  const res = await sql`SELECT value FROM fund_config WHERE key = 'brokerage_fee_pct'`;
  return parseFloat(res.rows[0]?.value ?? "2.0");
}

export async function updateBrokerageFeeRate(formData: FormData) {
  await requireAdmin();
  const rateStr = formData.get("brokerage_fee_pct")?.toString();
  if (!rateStr) return { error: "Rate is required" };
  const rate = parseFloat(rateStr);
  if (isNaN(rate) || rate < 0 || rate > 100) return { error: "Rate must be between 0 and 100" };

  await sql`
    INSERT INTO fund_config (key, value, updated_at)
    VALUES ('brokerage_fee_pct', ${rate.toString()}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  revalidatePath("/brokerage");
  return { success: true };
}

// ── Bonus Payments ────────────────────────────────────────────────────────────

export async function getAllBonusPayments() {
  await requireAdmin();
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
    WHERE bp.audit_status = 'active'
    ORDER BY bp.created_at DESC;
  `;
  return res.rows;
}

export async function getBonusByInvestor(investorId: string) {
  await requireAdmin();
  await ensureSettingsTables();
  const res = await sql`
    SELECT id, ledger_type, amount,
           TO_CHAR(date, 'YYYY-MM-DD') as date, notes
    FROM bonus_payments
    WHERE investor_id = ${investorId}
      AND audit_status = 'active'
    ORDER BY bonus_payments.date DESC;
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
    const latestNav = await sql`
      SELECT id, nav_per_unit
      FROM nav_weeks
      WHERE status = 'locked'
      ORDER BY week_ending DESC
      LIMIT 1
    `;
    const navWeek = latestNav.rows[0];
    if (!navWeek) {
      throw new Error("Equity bonuses require at least one locked weekly NAV.");
    }
    const navPerUnit = parseFloat(navWeek.nav_per_unit);
    const absAmount = Math.abs(amount);
    const isReversal = amount < 0;
    const redemption = isReversal
      ? redeemUnitsForWithdrawal({
          requestedAmount: absAmount,
          navPerUnit,
          availableUnits: await getInvestorUnitBalance(investorId),
        })
      : null;
    const units = redemption?.unitsRedeemed ?? issueUnitsForDeposit({ amount: absAmount, navPerUnit });
    const grossAmount = redemption?.grossAmount ?? absAmount;
    const r = await sql`
      INSERT INTO investor_unit_ledger (investor_id, nav_week_id, date, type, units, nav_per_unit, gross_amount, notes)
      VALUES (
        ${investorId},
        ${navWeek.id},
        ${date},
        ${isReversal ? "UnitRedemption" : "UnitIssue"},
        ${units},
        ${navPerUnit},
        ${grossAmount},
        ${notes}
      )
      RETURNING id
    `;
    const sourceId = r.rows[0]?.id;
    const bonus = await sql`
      INSERT INTO bonus_payments (investor_id, ledger_type, source_id, amount, date, notes)
      VALUES (${investorId}, 'equity', ${sourceId}, ${amount}, ${date}, ${notes})
      RETURNING id
    `;
    await writeAuditEvent("bonus_payment.add", "bonus_payments", bonus.rows[0].id, {
      investorId,
      ledgerType,
      sourceId,
      amount,
      date,
    });
  } else {
    // fixed_savings bonus has NO interest rate — it's a flat bonus, doesn't accrue
    const r = await sql`
      INSERT INTO fixed_savings_ledger (investor_id, date, type, amount, notes)
      VALUES (${investorId}, ${date}, 'Bonus', ${amount}, ${notes})
      RETURNING id
    `;
    const sourceId = r.rows[0]?.id;
    const bonus = await sql`
      INSERT INTO bonus_payments (investor_id, ledger_type, source_id, amount, date, notes)
      VALUES (${investorId}, 'fixed_savings', ${sourceId}, ${amount}, ${date}, ${notes})
      RETURNING id
    `;
    await writeAuditEvent("bonus_payment.add", "bonus_payments", bonus.rows[0].id, {
      investorId,
      ledgerType,
      sourceId,
      amount,
      date,
    });
  }
}

async function getInvestorUnitBalance(investorId: string) {
  const res = await sql`
    SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total
    FROM investor_unit_ledger
    WHERE investor_id = ${investorId}
      AND audit_status = 'active'
  `;
  return parseFloat(res.rows[0]?.total || "0");
}

export async function addBonusPayment(formData: FormData) {
  await requireAdmin();
  await ensureSettingsTables();
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
  if (isNaN(totalAmount) || totalAmount === 0) return { error: "Amount must be a non-zero number" };

  try {
    if (targetType === "specific") {
      if (!investorId) return { error: "Please select an investor" };
      await insertBonusRecord(investorId, ledgerType, totalAmount, date, notes || "Special bonus");
    } else {
      // Distribute proportionally to all investors
      const rows = ledgerType === "equity"
        ? await sql`
            WITH latest_nav AS (
              SELECT nav_per_unit
              FROM nav_weeks
              WHERE status = 'locked'
              ORDER BY week_ending DESC
              LIMIT 1
            )
            SELECT investor_id,
              SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END)
                * COALESCE((SELECT nav_per_unit FROM latest_nav), 1) as net
            FROM investor_unit_ledger
            WHERE audit_status = 'active'
            GROUP BY investor_id
            HAVING SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END) > 0
          `
        : await sql`
            SELECT investor_id,
              SUM(CASE WHEN type = 'Deposit' THEN amount WHEN type = 'Withdrawal' THEN -amount ELSE 0 END) as net
            FROM fixed_savings_ledger
            WHERE audit_status = 'active'
            GROUP BY investor_id
            HAVING SUM(CASE WHEN type = 'Deposit' THEN amount WHEN type = 'Withdrawal' THEN -amount ELSE 0 END) > 0
          `;
      const totalNet = rows.rows.reduce((s: number, r: any) => s + parseFloat(r.net), 0);
      if (totalNet <= 0) return { error: ledgerType === "equity" ? "No positive investor unit balance found to distribute to" : "No fixed savings balance found to distribute to" };

      for (const r of rows.rows) {
        const share = parseFloat(r.net) / totalNet;
        const investorBonus = totalAmount * share;
        if (Math.abs(investorBonus) > 0.001) {
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

    revalidatePath("/brokerage");
    revalidatePath("/investors");
    revalidatePath("/capital");
    revalidatePath("/reports");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to add bonus payment." };
  }
}

export async function deleteBonusPayment(_id: string) {
  await requireAdmin();
  void _id;
  return { error: "Financial bonus records cannot be deleted. Use Admin Logs revert instead." };
}
