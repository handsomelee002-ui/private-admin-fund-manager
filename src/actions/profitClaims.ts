"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { getBrokerageFeeRate } from "@/actions/settings";
import { requireAdmin } from "@/lib/auth";
import { calculateClaimSettlement } from "@/lib/profitClaimAccounting";

// ── Schema Migration ─────────────────────────────────────────────────────────
export async function ensureClaimsTable() {
  await requireAdmin();
  await sql`
    CREATE TABLE IF NOT EXISTS investor_profit_claims (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id     UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      locked_amount   NUMERIC(15, 4) NOT NULL,
      settled_amount  NUMERIC(15, 4) NOT NULL DEFAULT 0,
      brokerage_fee   NUMERIC(15, 4) NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'partial' | 'settled'
      claim_date      DATE NOT NULL,
      settled_date    DATE,
      notes           TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  // Add brokerage_fee column if table existed before this migration
  await sql`
    ALTER TABLE investor_profit_claims
    ADD COLUMN IF NOT EXISTS brokerage_fee NUMERIC(15, 4) NOT NULL DEFAULT 0;
  `;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getAllClaims() {
  await requireAdmin();
  const data = await sql`
    SELECT
      ipc.id,
      ipc.investor_id,
      i.name as investor_name,
      ipc.locked_amount,
      ipc.settled_amount,
      ipc.brokerage_fee,
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
  await requireAdmin();
  const data = await sql`
    SELECT
      id,
      investor_id,
      locked_amount,
      settled_amount,
      brokerage_fee,
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
  await requireAdmin();
  const investorId  = formData.get("investor_id")?.toString();
  const amountStr   = formData.get("locked_amount")?.toString();
  const claimDate   = formData.get("claim_date")?.toString();
  const notes       = formData.get("notes")?.toString() || "";

  if (!investorId || !amountStr || !claimDate) {
    return { error: "Missing required fields" };
  }
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return { error: "Amount must be a positive number" };

  // Pre-calculate and round brokerage fee (performance fee, 2dp precision)
  const brokerageRate     = await getBrokerageFeeRate();
  const roundedAmount     = Math.round(amount * 100) / 100;
  const roundedBrokerage  = Math.round(roundedAmount * (brokerageRate / 100) * 100) / 100;
  const netAmount         = Math.round((roundedAmount - roundedBrokerage) * 100) / 100;

  try {
    await sql`
      INSERT INTO investor_profit_claims (investor_id, locked_amount, brokerage_fee, claim_date, notes)
      VALUES (${investorId}, ${roundedAmount}, ${roundedBrokerage}, ${claimDate}, ${notes})
    `;
    revalidatePath("/claims");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/reports");
    return { success: true, brokerageFee: roundedBrokerage, netAmount };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to create profit claim." };
  }
}

// ── Settlement ────────────────────────────────────────────────────────────────
// Production logic:
//   - locked_amount = gross profit share owed to investor
//   - brokerage_fee = performance fee deducted by the fund manager (already calculated at lock time)
//   - net_payable   = locked_amount - brokerage_fee  (what investor actually receives)
//   - settled_amount tracks cumulative cash paid to investor (net of fee)
//   - On full settlement: create a ProfitDistribution entry in capital_ledger (cash outflow)
//     and a BrokerageIncome entry representing the fee earned
//
export async function settleClaim(formData: FormData) {
  await requireAdmin();
  const id               = formData.get("id")?.toString();
  const settledAmountStr = formData.get("settled_amount")?.toString();
  const settledDate      = formData.get("settled_date")?.toString();
  const notes            = formData.get("notes")?.toString() || "";

  if (!id || !settledAmountStr || !settledDate) {
    return { error: "Missing required fields" };
  }
  const settledAmount = parseFloat(settledAmountStr);
  if (isNaN(settledAmount) || settledAmount <= 0) return { error: "Settled amount must be positive" };

  try {
    // Fetch current claim including investor_id for ledger entries
    const current = await sql`
      SELECT locked_amount, settled_amount, brokerage_fee, investor_id
      FROM investor_profit_claims WHERE id = ${id}
    `;
    if (current.rows.length === 0) return { error: "Claim not found" };

    const locked       = parseFloat(current.rows[0].locked_amount);
    const prevSettled  = parseFloat(current.rows[0].settled_amount);
    const brokerageFee = parseFloat(current.rows[0].brokerage_fee || "0");
    const investorId   = current.rows[0].investor_id;

    const settlement = calculateClaimSettlement({
      lockedAmount: locked,
      previousSettledAmount: prevSettled,
      brokerageFee,
      requestedSettlementAmount: settledAmount,
    });
    if (settlement.cappedAmount <= 0) {
      return { error: "This claim is already fully settled." };
    }

    // ── Update the claim record ─────────────────────────────────────────────
    const notesParam = notes || null;
    await sql`
      UPDATE investor_profit_claims
      SET
        settled_amount = ${settlement.finalSettledAmount},
        settled_date   = ${settledDate},
        status         = ${settlement.status},
        notes          = COALESCE(NULLIF(${notesParam}, ''), notes)
      WHERE id = ${id}
    `;

    // ── On full settlement: record cash outflow in capital_ledger ───────────
    // "ProfitDistribution" type = profit paid out; excluded from equity calcs
    // The investor receives netPayable; the fund retains brokerageFee as income.
    if (settlement.isFullySettled) {
      await sql`
        INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
        VALUES (
          ${investorId},
          ${settledDate},
          'ProfitDistribution',
          ${settlement.ledgerAmount},
          ${`Profit claim settled — gross RM ${locked.toFixed(2)}, fee RM ${brokerageFee.toFixed(2)}, net RM ${settlement.netPayable.toFixed(2)}`}
        )
      `;
    } else {
      // Partial: record only the partial cash paid out
      await sql`
        INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
        VALUES (
          ${investorId},
          ${settledDate},
          'ProfitDistribution',
          ${settlement.ledgerAmount},
          ${`Partial profit settlement (${notes || "payment"})`}
        )
      `;
    }

    revalidatePath("/claims");
    revalidatePath("/investors");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/reports");
    revalidatePath("/brokerage");
    revalidatePath("/");
    return { success: true, netPaid: settlement.cappedAmount, brokerageFee: settlement.isFullySettled ? brokerageFee : 0 };
  } catch (error) {
    console.error("DB Error:", error);
    return { error: "Failed to settle claim." };
  }
}

export async function deleteClaim(id: string) {
  await requireAdmin();
  void id;
  return { error: "Profit claims cannot be hard-deleted. Settle, reverse through audit controls, or create a correcting claim." };
}
