"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Schema guard — runs silently before any query, no-op after first time
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getFixedSavingsLedger() {
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
      ORDER BY fs.date DESC, fs.created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch fixed savings ledger.");
  }
}

export async function getFixedSavingsByInvestor(investorId: string) {
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
  if (isNaN(amount)) return { error: "Amount must be a number" };

  const interestRate =
    interestRateStr && interestRateStr !== ""
      ? parseFloat(interestRateStr)
      : null;

  try {
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

export async function deleteFixedSavingsRecord(id: string) {
  try {
    await sql`DELETE FROM fixed_savings_ledger WHERE id = ${id}`;
    revalidatePath("/fixed-savings");
    revalidatePath("/investors");
    revalidatePath("/");
    revalidatePath("/reports");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete fixed savings record." };
  }
}
