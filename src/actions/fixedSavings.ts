"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Schema guard — runs silently before any query, no-op after first time
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getFixedSavingsLedger() {
  await requireAdmin();
  try {
    const data = await sql`
      SELECT 
        fs.id, 
        i.name as investor_name, 
        TO_CHAR(fs.date, 'YYYY-MM-DD') as date,
        fs.type, 
        fs.amount,
        fs.interest_rate,
        fs.notes
      FROM fixed_savings_ledger fs
      JOIN investors i ON fs.investor_id = i.id
      WHERE fs.audit_status = 'active'
      ORDER BY fs.date DESC, fs.created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch fixed savings ledger.");
  }
}

export async function getFixedSavingsByInvestor(investorId: string) {
  await requireAdmin();
  try {
    const data = await sql`
      SELECT 
        id, 
        TO_CHAR(date, 'YYYY-MM-DD') as date,
        type, 
        amount,
        interest_rate,
        notes
      FROM fixed_savings_ledger
      WHERE investor_id = ${investorId}
        AND audit_status = 'active'
      ORDER BY fixed_savings_ledger.date DESC, fixed_savings_ledger.created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch investor fixed savings ledger.");
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function addFixedSavingsRecord(formData: FormData) {
  await requireAdmin();
  const investorId = formData.get("investor_id")?.toString();
  const date = formData.get("date")?.toString();
  const type = formData.get("type")?.toString();
  const amountStr = formData.get("amount")?.toString();
  const notes = formData.get("notes")?.toString() || "";
  const interestRateStr = formData.get("interest_rate")?.toString();

  if (!investorId || !date || !type || !amountStr) {
    return { error: "Missing required fields" };
  }

  const amount = parseFloat(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than zero" };
  if (!["Deposit", "Withdrawal"].includes(type)) return { error: "Invalid fixed savings type" };

  const interestRate =
    interestRateStr && interestRateStr !== ""
      ? parseFloat(interestRateStr)
      : null;
  if (type === "Deposit" && (!Number.isFinite(interestRate) || Number(interestRate) <= 0)) {
    return { error: "Interest rate must be greater than zero for deposits" };
  }

  try {
    if (type === "Withdrawal") {
      const balance = await sql`
        SELECT COALESCE(SUM(CASE
          WHEN type IN ('Deposit', 'Bonus') THEN amount
          WHEN type IN ('Withdrawal', 'InterestWithdrawal') THEN -amount
          ELSE 0
        END), 0) as total
        FROM fixed_savings_ledger
        WHERE investor_id = ${investorId}
          AND audit_status = 'active'
      `;
      const available = parseFloat(balance.rows[0]?.total || "0");
      if (amount > available + 0.005) {
        return { error: `Withdrawal exceeds available fixed savings balance of RM ${available.toFixed(2)}.` };
      }
    }

    await sql`
      INSERT INTO fixed_savings_ledger (investor_id, date, type, amount, interest_rate, notes)
      VALUES (${investorId}, ${date}, ${type}, ${amount}, ${interestRate}, ${notes})
    `;

    revalidatePath("/fixed-savings");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to add fixed savings record." };
  }
}

export async function deleteFixedSavingsRecord(_id: string) {
  await requireAdmin();
  void _id;
  return { error: "Financial savings records cannot be deleted. Use Admin Logs revert instead." };
}
