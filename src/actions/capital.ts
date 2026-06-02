"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { getBrokerageFeeRate } from "@/actions/settings";
import { requireAdmin } from "@/lib/auth";

export async function getCapitalLedger() {
  await requireAdmin();
  try {
    const data = await sql`
      SELECT 
        cl.id, 
        i.name as investor_name, 
        TO_CHAR(cl.date, 'YYYY-MM-DD') as date,
        cl.type, 
        cl.amount, 
        cl.notes
      FROM capital_ledger cl
      JOIN investors i ON cl.investor_id = i.id
      ORDER BY cl.date DESC, cl.created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch capital ledger.");
  }
}

export async function getCapitalLedgerByInvestor(investorId: string) {
  await requireAdmin();
  try {
    const data = await sql`
      SELECT 
        id, 
        TO_CHAR(date, 'YYYY-MM-DD') as date,
        type, 
        amount, 
        notes
      FROM capital_ledger
      WHERE investor_id = ${investorId}
      ORDER BY capital_ledger.date DESC, capital_ledger.created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch investor capital ledger.");
  }
}

export async function addCapitalRecord(formData: FormData) {
  await requireAdmin();
  const investorId = formData.get("investor_id")?.toString();
  const date = formData.get("date")?.toString();
  const type = formData.get("type")?.toString();
  const amountStr = formData.get("amount")?.toString();
  const notes = formData.get("notes")?.toString() || "";

  if (!investorId || !date || !type || !amountStr) {
    return { error: "Missing required fields" };
  }

  const amount = parseFloat(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than zero" };
  if (!["Deposit", "Withdrawal", "Bonus"].includes(type)) return { error: "Invalid capital movement type" };

  try {
    // ── Auto profit claim on Withdrawal ────────────────────────────────────────────────
    // Compute BEFORE inserting so the equity ratio is correct at snapshot time
    let autoClaimedAmount = 0;
    if (type === "Withdrawal") {
      // Investor's current net equity (before this withdrawal)
      const investorEquityRes = await sql`
        SELECT COALESCE(SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount
                             WHEN type = 'Withdrawal' THEN -amount
                             ELSE 0 END), 0) as net
        FROM capital_ledger
        WHERE investor_id = ${investorId}
      `;
      const investorNetEquity = parseFloat(investorEquityRes.rows[0]?.net || 0);

      // Total fund equity (before this withdrawal)
      const totalFundRes = await sql`
        SELECT COALESCE(SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount
                             WHEN type = 'Withdrawal' THEN -amount
                             ELSE 0 END), 0) as total
        FROM capital_ledger
      `;
      const totalFundEquity = parseFloat(totalFundRes.rows[0]?.total || 0);

      // Latest locked weekly NAV platform snapshots (can be negative)
      const unrealizedRes = await sql`
        SELECT COALESCE(SUM(unrealized_profit), 0) as total
        FROM (
          SELECT nwps.unrealized_profit,
                 ROW_NUMBER() OVER(PARTITION BY nwps.platform_id ORDER BY nw.week_ending DESC) as rn
          FROM nav_week_platform_snapshots nwps
          JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
          WHERE nw.status = 'locked'
        ) sub
        WHERE rn = 1
      `;
      const totalUnrealized = parseFloat(unrealizedRes.rows[0]?.total || 0);

      // ── NAV Validation ────────────────────────────────────────────────────
      // Production rule: withdrawal is capped at the investor's current NAV.
      // NAV = capital equity + pro-rata share of unrealized P/L (can be negative).
      // An investor cannot withdraw more than their NAV — the fund would be
      // paying out cash it doesn’t hold for that investor.
      const profitLossShare =
        totalFundEquity > 0 ? (investorNetEquity / totalFundEquity) * totalUnrealized : 0;
      // Round to 2dp (cent precision)
      const investorNAV = Math.round((investorNetEquity + profitLossShare) * 100) / 100;
      const withdrawalAmt = Math.round(amount * 100) / 100;

      if (investorNAV <= 0) {
        return {
          error:
            `Withdrawal blocked: the investor's current NAV is RM 0.00 ` +
            `(net equity: RM ${investorNetEquity.toFixed(2)}, ` +
            `unrealized P/L share: RM ${profitLossShare.toFixed(2)}). ` +
            `There is nothing to withdraw.`,
        };
      }
      if (withdrawalAmt > investorNAV + 0.005) {
        return {
          error:
            `Withdrawal of RM ${withdrawalAmt.toFixed(2)} exceeds the investor's ` +
            `current NAV of RM ${investorNAV.toFixed(2)} ` +
            `(equity: RM ${investorNetEquity.toFixed(2)}, ` +
            `unrealized P/L share: RM ${profitLossShare.toFixed(2)}). ` +
            `Maximum withdrawable: RM ${investorNAV.toFixed(2)}.`,
        };
      }

      // ── Auto profit claim (only when unrealized is positive) ──────────────────
      // Rounded to 2dp before storage
      if (totalFundEquity > 0 && totalUnrealized > 0) {
        const raw = (investorNetEquity / totalFundEquity) * totalUnrealized;
        autoClaimedAmount = Math.round(raw * 100) / 100;
      }
    }

    // ── Insert the capital record ─────────────────────────────────────────────
    await sql`
      INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
      VALUES (${investorId}, ${date}, ${type}, ${amount}, ${notes})
    `;

    // ── Auto-create profit claim if withdrawal and unrealized > 0 ────────────
    if (type === "Withdrawal" && autoClaimedAmount > 0) {
      const brokerageRate = await getBrokerageFeeRate();
      const brokerageFee  = Math.round(autoClaimedAmount * (brokerageRate / 100) * 100) / 100;
      await sql`
        INSERT INTO investor_profit_claims (investor_id, locked_amount, brokerage_fee, claim_date, notes)
        VALUES (
          ${investorId},
          ${autoClaimedAmount},
          ${brokerageFee},
          ${date},
          ${'Auto-locked on capital withdrawal'}
        )
      `;
      revalidatePath("/claims");
    }

    revalidatePath("/capital");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/");
    revalidatePath("/reports");
    return { success: true, autoClaimedAmount };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to add capital record." };
  }
}

export async function deleteCapitalRecord(id: string) {
  await requireAdmin();
  void id;
  return { error: "Capital records cannot be hard-deleted. Use Admin Logs revert or a current-period adjustment." };
}
