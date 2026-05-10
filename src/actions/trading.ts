"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

// --- PLATFORMS ---

export async function getPlatforms() {
  try {
    const data = await sql`
      SELECT 
        p.id, 
        p.name,
        COALESCE(SUM(CASE WHEN pt.type = 'Deposit' THEN pt.amount ELSE -pt.amount END), 0) as net_invested
      FROM platforms p
      LEFT JOIN platform_transactions pt ON p.id = pt.platform_id
      GROUP BY p.id, p.name
      ORDER BY p.name ASC;
    `;
    
    const perfData = await sql`
      SELECT platform_id, unrealized_profit 
      FROM (
        SELECT platform_id, unrealized_profit,
               ROW_NUMBER() OVER(PARTITION BY platform_id ORDER BY month DESC) as rn
        FROM platform_performance
      ) sub
      WHERE rn = 1;
    `;
    
    const latestPerfMap = new Map();
    perfData.rows.forEach(row => {
      latestPerfMap.set(row.platform_id, parseFloat(row.unrealized_profit || 0));
    });

    return data.rows.map((row: any) => {
      const netInvested = parseFloat(row.net_invested || 0);
      const unrealizedProfit = latestPerfMap.get(row.id) || 0;
      return {
        id: row.id,
        name: row.name,
        netInvested,
        unrealizedProfit,
        totalValue: netInvested + unrealizedProfit
      };
    });
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch platforms.");
  }
}

export async function getPlatform(id: string) {
  try {
    const data = await sql`SELECT id, name FROM platforms WHERE id = ${id}`;
    return data.rows[0];
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch platform.");
  }
}

export async function addPlatform(formData: FormData) {
  const name = formData.get("name")?.toString();
  if (!name) return { error: "Platform name is required" };

  try {
    await sql`INSERT INTO platforms (name) VALUES (${name})`;
    revalidatePath("/trading");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to add platform." };
  }
}

export async function updatePlatformName(formData: FormData) {
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString()?.trim();
  if (!id || !name) return { error: "ID and new name are required" };

  try {
    await sql`UPDATE platforms SET name = ${name} WHERE id = ${id}`;
    revalidatePath("/trading");
    revalidatePath(`/trading/${id}`);
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to update platform name." };
  }
}

export async function deletePlatform(id: string) {
  try {
    await sql`DELETE FROM platforms WHERE id = ${id}`;
    revalidatePath("/trading");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete platform." };
  }
}

// --- TRANSACTIONS ---

export async function getPlatformTransactions(platformId: string) {
  try {
    const data = await sql`
      SELECT 
        id, 
        platform_id, 
        TO_CHAR(date, 'YYYY-MM-DD') as date, 
        type, 
        amount, 
        notes 
      FROM platform_transactions
      WHERE platform_id = ${platformId}
      ORDER BY date DESC, created_at DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch transactions.");
  }
}

export async function addPlatformTransaction(formData: FormData) {
  const platformId = formData.get("platform_id")?.toString();
  const date = formData.get("date")?.toString();
  const type = formData.get("type")?.toString();
  const amountStr = formData.get("amount")?.toString();
  const notes = formData.get("notes")?.toString() || "";

  if (!platformId || !date || !type || !amountStr) {
    return { error: "Missing required fields" };
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return { error: "Amount must be a valid number" };

  try {
    await sql`
      INSERT INTO platform_transactions (platform_id, date, type, amount, notes)
      VALUES (${platformId}, ${date}, ${type}, ${amount}, ${notes})
    `;
    revalidatePath(`/trading/${platformId}`);
    revalidatePath("/trading");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to add transaction." };
  }
}

export async function deletePlatformTransaction(id: string) {
  try {
    await sql`DELETE FROM platform_transactions WHERE id = ${id}`;
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete transaction." };
  }
}

// --- PERFORMANCE ---

export async function getPlatformPerformance(platformId: string) {
  try {
    const data = await sql`
      SELECT 
        id, 
        platform_id, 
        month, 
        unrealized_profit 
      FROM platform_performance
      WHERE platform_id = ${platformId}
      ORDER BY month DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch performance data.");
  }
}

export async function upsertPlatformPerformance(formData: FormData) {
  const platformId = formData.get("platform_id")?.toString();
  const month = formData.get("month")?.toString();
  const profitStr = formData.get("unrealized_profit")?.toString();

  if (!platformId || !month || !profitStr) {
    return { error: "Missing required fields" };
  }

  const profit = parseFloat(profitStr);
  if (isNaN(profit)) return { error: "Unrealized profit must be a valid number" };

  try {
    await sql`
      INSERT INTO platform_performance (platform_id, month, unrealized_profit)
      VALUES (${platformId}, ${month}, ${profit})
      ON CONFLICT (platform_id, month) 
      DO UPDATE SET unrealized_profit = EXCLUDED.unrealized_profit
    `;
    revalidatePath(`/trading/${platformId}`);
    revalidatePath("/trading");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to update performance data." };
  }
}

export async function deletePlatformPerformance(id: string) {
  try {
    await sql`DELETE FROM platform_performance WHERE id = ${id}`;
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete performance record." };
  }
}
