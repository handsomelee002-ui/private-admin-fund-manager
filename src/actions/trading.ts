"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

// Auto-migrate: add realized_profit column if not present
export async function ensureRealizedProfitColumn() {
  await sql`
    ALTER TABLE platform_transactions
    ADD COLUMN IF NOT EXISTS realized_profit NUMERIC(15, 4) DEFAULT NULL;
  `;
}

// --- PLATFORMS ---

export async function getPlatforms() {
  try {
    const data = await sql`
      SELECT 
        p.id, 
        p.name,
        TO_CHAR(p.created_at, 'YYYY-MM-DD') as created_at,
        COALESCE(SUM(CASE WHEN pt.type = 'Deposit' THEN pt.amount ELSE -pt.amount END), 0) as net_invested,
        COALESCE(SUM(CASE WHEN pt.realized_profit IS NOT NULL THEN pt.realized_profit ELSE 0 END), 0) as realized_profit
      FROM platforms p
      LEFT JOIN platform_transactions pt ON p.id = pt.platform_id
      GROUP BY p.id, p.name, p.created_at
      ORDER BY p.created_at DESC, p.name ASC;
    `;
    
    const perfData = await sql`
      SELECT platform_id, unrealized_profit
      FROM (
        SELECT nwps.platform_id, nwps.unrealized_profit,
               ROW_NUMBER() OVER(PARTITION BY nwps.platform_id ORDER BY nw.week_ending DESC) as rn
        FROM nav_week_platform_snapshots nwps
        JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
        WHERE nw.status = 'locked'
      ) sub
      WHERE rn = 1;
    `;
    
    const latestPerfMap = new Map();
    perfData.rows.forEach(row => {
      latestPerfMap.set(row.platform_id, parseFloat(row.unrealized_profit || 0));
    });

    return data.rows.map((row: any) => {
      const netInvested = parseFloat(row.net_invested || 0);
      const realizedProfit = parseFloat(row.realized_profit || 0);
      const unrealizedProfit = latestPerfMap.get(row.id) || 0;
      return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        netInvested,
        realizedProfit,
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
    const data = await sql`SELECT id, name, TO_CHAR(created_at, 'YYYY-MM-DD') as created_at FROM platforms WHERE id = ${id}`;
    return data.rows[0];
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch platform.");
  }
}

export async function addPlatform(formData: FormData) {
  const name = formData.get("name")?.toString()?.trim();
  if (!name) return { error: "Platform name is required" };

  try {
    const existing = await sql`SELECT id FROM platforms WHERE name = ${name}`;
    if (existing.rows.length > 0) {
      return { error: "A platform with this name already exists." };
    }

    const created = await sql`INSERT INTO platforms (name) VALUES (${name}) RETURNING id`;
    revalidatePath("/trading");
    revalidatePath("/nav");
    return { success: true, id: created.rows[0].id };
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
    revalidatePath("/nav");
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
    revalidatePath("/nav");
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
        realized_profit,
        notes 
      FROM platform_transactions
      WHERE platform_id = ${platformId}
      ORDER BY platform_transactions.date DESC, platform_transactions.created_at DESC;
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
  const realizedProfitStr = formData.get("realized_profit")?.toString();

  if (!platformId || !date || !type || !amountStr) {
    return { error: "Missing required fields" };
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return { error: "Amount must be a valid number" };

  const realizedProfit =
    realizedProfitStr && realizedProfitStr !== ""
      ? parseFloat(realizedProfitStr)
      : null;
  if (realizedProfit !== null && !Number.isFinite(realizedProfit)) {
    return { error: "Realized profit must be a valid number" };
  }

  try {
    await sql`
      INSERT INTO platform_transactions (platform_id, date, type, amount, realized_profit, notes)
      VALUES (${platformId}, ${date}, ${type}, ${amount}, ${realizedProfit}, ${notes})
    `;
    revalidatePath(`/trading/${platformId}`);
    revalidatePath("/trading");
    revalidatePath("/nav");
    revalidatePath("/");
    revalidatePath("/reports");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to add transaction." };
  }
}

export async function deletePlatformTransaction(id: string) {
  try {
    const deleted = await sql`DELETE FROM platform_transactions WHERE id = ${id} RETURNING platform_id`;
    const platformId = deleted.rows[0]?.platform_id;
    if (platformId) revalidatePath(`/trading/${platformId}`);
    revalidatePath("/trading");
    revalidatePath("/nav");
    revalidatePath("/");
    revalidatePath("/reports");
    return { success: true };
  } catch (error) {
    console.error("Database Error:", error);
    return { error: "Failed to delete transaction." };
  }
}

// --- PERFORMANCE ---

export async function getPlatformNavSnapshots(platformId: string) {
  try {
    const data = await sql`
      SELECT 
        nwps.id,
        nwps.platform_id,
        TO_CHAR(nw.week_ending, 'YYYY-MM-DD') as week_ending,
        nwps.net_invested,
        nwps.unrealized_profit,
        nw.nav_per_unit,
        nw.status
      FROM nav_week_platform_snapshots nwps
      JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
      WHERE nwps.platform_id = ${platformId}
        AND nw.status = 'locked'
      ORDER BY nw.week_ending DESC;
    `;
    return data.rows;
  } catch (error) {
    console.error("Database Error:", error);
    throw new Error("Failed to fetch platform NAV snapshots.");
  }
}
