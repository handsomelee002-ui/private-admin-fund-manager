"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";

// ── Schema Migration ─────────────────────────────────────────────────────────
export async function ensureClaimsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS investor_profit_claims (
      id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      locked_amount   NUMERIC(15, 4) NOT NULL,
      settled_amount  NUMERIC(15, 4) NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'partial' | 'settled'
      claim_date      DATE NOT NULL,
      settled_date    DATE,
      notes           TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getAllClaims() {
  await ensureClaimsTable();
  const data = await sql`
    SELECT
      ipc.id,
      ipc.investor_id,
      i.name as investor_name,
      ipc.locked_amount,
      ipc.settled_amount,
      ipc.status,
      TO_CHAR(ipc.claim_date, 'YYYY-MM-DD')   as claim_date,
      TO_CHAR(ipc.settled_date, 'YYYY-MM-DD') as settled_date,
      ipc.notes,
      ipc.created_at
    FROM investor_profit_claims ipc
    JOIN investors i ON ipc.investor_id = i.id
    ORDER BY ipc.created_at DESC;
  `;
  return data.rows;
}

export async function getClaimsByInvestor(investorId: string) {
  await ensureClaimsTable();
  const data = await sql`
    SELECT
      id,
      investor_id,
      locked_amount,
      settled_amount,
      status,
      TO_CHAR(claim_date, 'YYYY-MM-DD')   as claim_date,
      TO_CHAR(settled_date, 'YYYY-MM-DD') as settled_date,
      notes
    FROM investor_profit_claims
    WHERE investor_id = ${investorId}
    ORDER BY created_at DESC;
  `;
  return data.rows;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function addProfitClaim(formData: FormData) {
  const investorId  = formData.get("investor_id")?.toString();
  const amountStr   = formData.get("locked_amount")?.toString();
  const claimDate   = formData.get("claim_date")?.toString();
  const notes       = formData.get("notes")?.toString() || "";

  if (!investorId || !amountStr || !claimDate) {
    return { error: "Missing required fields" };
  }
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return { error: "Amount must be a positive number" };

  await ensureClaimsTable();
  try {
    await sql`
      INSERT INTO investor_profit_claims (investor_id, locked_amount, claim_date, notes)
      VALUES (${investorId}, ${amount}, ${claimDate}, ${notes})
    `;
    revalidatePath("/claims");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/reports");
    return { success: true };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to create profit claim." };
  }
}

export async function settleClaim(formData: FormData) {
  const id              = formData.get("id")?.toString();
  const settledAmountStr = formData.get("settled_amount")?.toString();
  const settledDate     = formData.get("settled_date")?.toString();
  const notes           = formData.get("notes")?.toString() || "";

  if (!id || !settledAmountStr || !settledDate) {
    return { error: "Missing required fields" };
  }
  const settledAmount = parseFloat(settledAmountStr);
  if (isNaN(settledAmount) || settledAmount <= 0) return { error: "Settled amount must be positive" };

  await ensureClaimsTable();
  try {
    // Get current claim to compute new total settled
    const current = await sql`SELECT locked_amount, settled_amount FROM investor_profit_claims WHERE id = ${id}`;
    if (current.rows.length === 0) return { error: "Claim not found" };

    const locked       = parseFloat(current.rows[0].locked_amount);
    const prevSettled  = parseFloat(current.rows[0].settled_amount);
    const newSettled   = prevSettled + settledAmount;
    const newStatus    = newSettled >= locked ? "settled" : "partial";

    await sql`
      UPDATE investor_profit_claims
      SET
        settled_amount = ${newSettled},
        settled_date   = ${settledDate},
        status         = ${newStatus},
        notes          = CASE WHEN ${notes} != '' THEN ${notes} ELSE notes END
      WHERE id = ${id}
    `;
    revalidatePath("/claims");
    revalidatePath("/reports");
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to settle claim." };
  }
}

export async function deleteClaim(id: string) {
  await ensureClaimsTable();
  try {
    await sql`DELETE FROM investor_profit_claims WHERE id = ${id}`;
    revalidatePath("/claims");
    revalidatePath("/reports");
    return { success: true };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to delete claim." };
  }
}
