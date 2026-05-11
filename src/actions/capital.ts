"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { ensureClaimsTable } from "@/actions/profitClaims";

export async function getCapitalLedger() {
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
      ORDER BY date DESC, created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch investor capital ledger.");
  }
}

export async function addCapitalRecord(formData: FormData) {
  const investorId = formData.get("investor_id")?.toString();
  const date = formData.get("date")?.toString();
  const type = formData.get("type")?.toString();
  const amountStr = formData.get("amount")?.toString();
  const notes = formData.get("notes")?.toString() || "";

  if (!investorId || !date || !type || !amountStr) {
    return { error: "Missing required fields" };
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return { error: "Amount must be a number" };

  try {
    // ── Auto profit claim on Withdrawal ──────────────────────────────────────
    // Calculate BEFORE inserting the withdrawal so the equity share is correct
    let autoClaimedAmount = 0;
    if (type === "Withdrawal") {
      // Investor's current net equity (before this withdrawal)
      const investorEquityRes = await sql`
        SELECT COALESCE(SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount ELSE -amount END), 0) as net
        FROM capital_ledger
        WHERE investor_id = ${investorId}
      `;
      const investorNetEquity = parseFloat(investorEquityRes.rows[0]?.net || 0);

      // Total fund equity (before this withdrawal)
      const totalFundRes = await sql`
        SELECT COALESCE(SUM(CASE WHEN type IN ('Deposit','Bonus') THEN amount ELSE -amount END), 0) as total
        FROM capital_ledger
      `;
      const totalFundEquity = parseFloat(totalFundRes.rows[0]?.total || 0);

      // Latest total unrealized profit across all platforms
      const unrealizedRes = await sql`
        SELECT COALESCE(SUM(unrealized_profit), 0) as total
        FROM (
          SELECT unrealized_profit,
                 ROW_NUMBER() OVER(PARTITION BY platform_id ORDER BY month DESC) as rn
          FROM platform_performance
        ) sub WHERE rn = 1
      `;
      const totalUnrealized = parseFloat(unrealizedRes.rows[0]?.total || 0);

      // Investor's share of unrealized profit
      if (totalFundEquity > 0 && totalUnrealized > 0) {
        autoClaimedAmount = (investorNetEquity / totalFundEquity) * totalUnrealized;
      }
    }

    // ── Insert the capital record ─────────────────────────────────────────────
    await sql`
      INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
      VALUES (${investorId}, ${date}, ${type}, ${amount}, ${notes})
    `;

    // ── Auto-create profit claim if withdrawal and unrealized > 0 ────────────
    if (type === "Withdrawal" && autoClaimedAmount > 0) {
      await ensureClaimsTable();
      await sql`
        INSERT INTO investor_profit_claims (investor_id, locked_amount, claim_date, notes)
        VALUES (
          ${investorId},
          ${autoClaimedAmount},
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
  try {
    await sql`DELETE FROM capital_ledger WHERE id = ${id}`;
    revalidatePath("/capital");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete capital record." };
  }
}
