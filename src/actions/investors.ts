"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

export async function getInvestors() {
  try {
    const data = await sql`
      SELECT 
        i.id, 
        i.name, 
        TO_CHAR(i.created_at, 'YYYY-MM-DD') as joined,
        COALESCE(SUM(CASE WHEN cl.type IN ('Deposit', 'Bonus') THEN cl.amount ELSE 0 END) - 
                 SUM(CASE WHEN cl.type = 'Withdrawal' THEN cl.amount ELSE 0 END), 0) as total_capital
      FROM investors i
      LEFT JOIN capital_ledger cl ON i.id = cl.investor_id
      GROUP BY i.id
      ORDER BY i.created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch investors.");
  }
}

export async function addInvestor(formData: FormData) {
  const name = formData.get("name")?.toString()?.trim();
  if (!name) return { error: "Name is required" };

  try {
    const existing = await sql`SELECT id FROM investors WHERE name = ${name}`;
    if (existing.rows.length > 0) {
      return { error: "An investor with this name already exists." };
    }

    await sql`INSERT INTO investors (name) VALUES (${name})`;
    revalidatePath("/investors");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to add investor." };
  }
}

export async function deleteInvestor(id: string) {
  try {
    await sql`DELETE FROM investors WHERE id = ${id}`;
    revalidatePath("/investors");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete investor." };
  }
}

export async function updateInvestorName(formData: FormData) {
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString()?.trim();
  if (!id || !name) return { error: "ID and new name are required" };

  try {
    const existing = await sql`SELECT id FROM investors WHERE name = ${name} AND id != ${id}`;
    if (existing.rows.length > 0) {
      return { error: "An investor with this name already exists." };
    }

    await sql`UPDATE investors SET name = ${name} WHERE id = ${id}`;
    revalidatePath("/investors");
    revalidatePath(`/investors/${id}`);
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to update investor name." };
  }
}

