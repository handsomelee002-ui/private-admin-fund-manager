"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getInvestorsWithBalances } from "@/lib/fundDb";

export async function getInvestors() {
  try {
    return await getInvestorsWithBalances();
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch investors.");
  }
}

export async function addInvestor(formData: FormData) {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
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

