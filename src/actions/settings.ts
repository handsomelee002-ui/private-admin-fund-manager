"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { issueUnitsForDeposit, redeemUnitsForWithdrawal } from "@/lib/accounting";
import {
  assertNoLockedNavOnOrAfter,
  assertNotFutureDate,
  calculateFixedSavingsLiability,
  getFixedSavingsRateInputs,
  withTransaction,
  writeAuditEvent,
} from "@/lib/fundDb";
import { roundMoney } from "@/lib/accounting";
import { isRedirectError, requireAdmin } from "@/lib/auth";

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
    // The ledger row and its bonus_payments record identify each other; a
    // half-written pair reads as an ordinary unit issue with no bonus behind it.
    await withTransaction(async (db) => {
      const r = await db`
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
      const bonus = await db`
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
      }, db);
    });
  } else {
    // fixed_savings bonus has NO interest rate — it's a flat bonus, doesn't accrue
    await withTransaction(async (db) => {
      const r = await db`
        INSERT INTO fixed_savings_ledger (investor_id, date, type, amount, notes)
        VALUES (${investorId}, ${date}, 'Bonus', ${amount}, ${notes})
        RETURNING id
      `;
      const sourceId = r.rows[0]?.id;
      const bonus = await db`
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
      }, db);
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
  if (!["equity", "fixed_savings"].includes(ledgerType)) return { error: "Invalid bonus ledger type" };
  const totalAmount = parseFloat(amountStr);
  if (isNaN(totalAmount) || totalAmount === 0) return { error: "Amount must be a non-zero number" };

  // Bonuses were the one financial record with neither guard: a post-dated
  // bonus was accepted, and one dated beneath a locked NAV retroactively
  // changed the unit count that NAV was built on.
  try {
    assertNotFutureDate(date, "Bonus date");
    await assertNoLockedNavOnOrAfter(date, "the bonus");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Invalid bonus date." };
  }

  try {
    if (targetType === "specific") {
      if (!investorId) return { error: "Please select an investor" };
      await insertBonusRecord(investorId, ledgerType, totalAmount, date, notes || "Special bonus");
    } else {
      // Distribute proportionally to all investors.
      let balances: { investor_id: string; net: number }[];
      if (ledgerType === "equity") {
        const rows = await sql`
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
            AND date <= ${date}
          GROUP BY investor_id
          HAVING SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END) > 0
        `;
        balances = rows.rows.map((r: any) => ({ investor_id: r.investor_id, net: parseFloat(r.net) }));
      } else {
        // Share by the actual liability - principal plus accrued interest and
        // bonuses - not by raw deposits minus withdrawals, which ignored
        // everything a saver had earned and mismatched their real balance.
        const [savingsRows, rateInput] = await Promise.all([
          sql`
            SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
            FROM fixed_savings_ledger
            WHERE audit_status = 'active' AND date <= ${date}
            ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
          `,
          getFixedSavingsRateInputs(),
        ]);
        const liability = calculateFixedSavingsLiability(savingsRows.rows as any[], date, rateInput);
        balances = [...liability.byInvestor.entries()]
          .filter(([investorId, summary]) => investorId !== "fund" && summary.totalLiability > 0)
          .map(([investorId, summary]) => ({ investor_id: investorId, net: summary.totalLiability }));
      }

      const totalNet = roundMoney(balances.reduce((sum, row) => sum + row.net, 0));
      if (totalNet <= 0) return { error: ledgerType === "equity" ? "No positive investor unit balance found to distribute to" : "No fixed savings balance found to distribute to" };

      // Give the rounding remainder to the largest holder rather than letting
      // the distributed total silently fall short of the amount entered.
      const ordered = [...balances].sort((a, b) => b.net - a.net);
      const rounded = roundMoney(totalAmount);
      let allocated = 0;
      const shares = ordered.map((row, index) => {
        const amount = index === ordered.length - 1
          ? roundMoney(rounded - allocated)
          : roundMoney(rounded * (row.net / totalNet));
        allocated = roundMoney(allocated + amount);
        return { investorId: row.investor_id, amount };
      });

      for (const share of shares) {
        if (Math.abs(share.amount) < 0.005) continue;
        await insertBonusRecord(
          share.investorId,
          ledgerType,
          share.amount,
          date,
          notes || (ledgerType === "equity" ? "Proportional equity bonus" : "Proportional savings bonus"),
        );
      }
    }

    revalidatePath("/brokerage");
    revalidatePath("/investors");
    revalidatePath("/capital");
    revalidatePath("/reports");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("DB Error:", error);
    return { error: "Failed to add bonus payment." };
  }
}

export async function deleteBonusPayment(_id: string) {
  await requireAdmin();
  void _id;
  return { error: "Financial bonus records cannot be deleted. Use Admin Logs revert instead." };
}
