"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

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
    await sql`
      INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
      VALUES (${investorId}, ${date}, ${type}, ${amount}, ${notes})
    `;
    revalidatePath("/capital");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/");
    return { success: true };
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
