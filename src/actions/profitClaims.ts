"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { getBrokerageFeeRate } from "@/actions/settings";
import { isRedirectError, requireAdmin } from "@/lib/auth";
import { assertNotFutureDate, ensureAuditColumns, getInvestorStatement, redeemUnitsForProfitClaim, withTransaction, writeAuditEvent } from "@/lib/fundDb";
import { calculateClaimSettlement } from "@/lib/profitClaimAccounting";

/**
 * Profit an investor can still lock into a claim: their equity gain at the
 * latest locked NAV (market value less remaining cost basis) minus profit
 * already locked in existing claims. Claiming beyond this books profit the
 * investor has not made.
 *
 * The gain comes from getInvestorStatement so the cost-basis and bonus-unit
 * handling stays in one place.
 */
async function getClaimableProfit(investorId: string) {
  const [statement, locked] = await Promise.all([
    getInvestorStatement(investorId),
    // Only the *outstanding* part of a claim still blocks further claiming.
    // Settling redeems units, which already removes that profit from the
    // investor's position, so counting it again here would permanently strand
    // profit the investor has genuinely earned since.
    sql`
      SELECT COALESCE(SUM(GREATEST(locked_amount - COALESCE(settled_gross_amount, 0), 0)), 0) as total
      FROM investor_profit_claims
      WHERE investor_id = ${investorId}
    `,
  ]);

  const equityProfit = Number(statement?.marketValue ?? 0) - Number(statement?.netInvestedCapital ?? 0);
  const alreadyLocked = parseFloat(locked.rows[0]?.total || "0");
  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    attributableProfit: round(equityProfit),
    alreadyLocked: round(alreadyLocked),
    claimable: round(Math.max(0, equityProfit - alreadyLocked)),
  };
}

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
  // Gross profit already crystallized out of the investor's position by
  // settlement, as opposed to settled_amount which is the net cash paid.
  await sql`
    ALTER TABLE investor_profit_claims
    ADD COLUMN IF NOT EXISTS settled_gross_amount NUMERIC(15, 4) NOT NULL DEFAULT 0;
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

  try {
    assertNotFutureDate(claimDate, "Claim date");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Invalid claim date." };
  }

  // Pre-calculate and round brokerage fee (performance fee, 2dp precision)
  const brokerageRate     = await getBrokerageFeeRate();
  const roundedAmount     = Math.round(amount * 100) / 100;
  const roundedBrokerage  = Math.round(roundedAmount * (brokerageRate / 100) * 100) / 100;
  const netAmount         = Math.round((roundedAmount - roundedBrokerage) * 100) / 100;

  try {
    await ensureAuditColumns();
    const { attributableProfit, alreadyLocked, claimable } = await getClaimableProfit(investorId);
    if (roundedAmount > claimable + 0.005) {
      return {
        error:
          `Claim of RM ${roundedAmount.toFixed(2)} exceeds this investor's claimable profit of RM ${claimable.toFixed(2)} ` +
          `(attributable equity profit RM ${attributableProfit.toFixed(2)}, already locked in claims RM ${alreadyLocked.toFixed(2)}).`,
      };
    }

    const inserted = await sql`
      INSERT INTO investor_profit_claims (investor_id, locked_amount, brokerage_fee, claim_date, notes)
      VALUES (${investorId}, ${roundedAmount}, ${roundedBrokerage}, ${claimDate}, ${notes})
      RETURNING id
    `;
    await writeAuditEvent("profit_claim.add", "investor_profit_claims", inserted.rows[0].id, {
      investorId,
      lockedAmount: roundedAmount,
      brokerageFee: roundedBrokerage,
      netAmount,
      claimDate,
      attributableProfit,
      alreadyLocked,
    });
    revalidatePath("/claims");
    revalidatePath("/admin-logs");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/reports");
    return { success: true, brokerageFee: roundedBrokerage, netAmount };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("DB Error:", error);
    return { error: error instanceof Error ? error.message : "Failed to create profit claim." };
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
    assertNotFutureDate(settledDate, "Settlement date");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Invalid settlement date." };
  }

  try {
    await ensureAuditColumns();
    // Fetch current claim including investor_id for ledger entries
    const current = await sql`
      SELECT locked_amount, settled_amount, settled_gross_amount, brokerage_fee, investor_id
      FROM investor_profit_claims WHERE id = ${id}
    `;
    if (current.rows.length === 0) return { error: "Claim not found" };

    const locked           = parseFloat(current.rows[0].locked_amount);
    const prevSettled      = parseFloat(current.rows[0].settled_amount);
    const prevSettledGross = parseFloat(current.rows[0].settled_gross_amount || "0");
    const brokerageFee     = parseFloat(current.rows[0].brokerage_fee || "0");
    const investorId       = current.rows[0].investor_id;

    const settlement = calculateClaimSettlement({
      lockedAmount: locked,
      previousSettledAmount: prevSettled,
      brokerageFee,
      requestedSettlementAmount: settledAmount,
    });
    if (settlement.cappedAmount <= 0) {
      return { error: "This claim is already fully settled." };
    }

    // ── Crystallize the profit out of the investor's own position ───────────
    // Paying cash without redeeming units left the claimant holding the units
    // that produced the profit while the outgoing cash diluted everyone else.
    // The gross share of this instalment is what leaves their position; they
    // receive the net and the fund keeps the fee.
    const grossThisSettlement =
      settlement.netPayable > 0
        ? Math.round(locked * (settlement.cappedAmount / settlement.netPayable) * 100) / 100
        : settlement.cappedAmount;
    const feeThisSettlement = Math.round((grossThisSettlement - settlement.cappedAmount) * 100) / 100;

    const notesParam = notes || null;
    const settledGross = Math.round((prevSettledGross + grossThisSettlement) * 100) / 100;
    const ledgerNote = settlement.isFullySettled
      ? `Profit claim settled — gross RM ${locked.toFixed(2)}, fee RM ${brokerageFee.toFixed(2)}, net RM ${settlement.netPayable.toFixed(2)}`
      : `Partial profit settlement (${notes || "payment"})`;

    let redemption;
    let ledgerEntryId: string;
    try {
      // Redemption, claim update and distribution record are one unit: a
      // half-applied settlement would either pay cash without shrinking the
      // position or shrink it without recording the payment.
      const result = await withTransaction(async (db) => {
        const redeemed = await redeemUnitsForProfitClaim({
          investorId,
          date: settledDate,
          grossAmount: grossThisSettlement,
          feeAmount: feeThisSettlement,
          notes: `Profit claim settlement — gross RM ${grossThisSettlement.toFixed(2)}, fee RM ${feeThisSettlement.toFixed(2)}, net RM ${settlement.cappedAmount.toFixed(2)}`,
        }, db);
        await db`
          UPDATE investor_profit_claims
          SET
            settled_amount       = ${settlement.finalSettledAmount},
            settled_gross_amount = ${settledGross},
            settled_date         = ${settledDate},
            status               = ${settlement.status},
            notes                = COALESCE(NULLIF(${notesParam}, ''), notes)
          WHERE id = ${id}
        `;
        // Retained as a human-readable record of the distribution. The balance
        // impact now lives in the unit ledger and cash movement above.
        const ledger = await db`
          INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
          VALUES (
            ${investorId},
            ${settledDate},
            'ProfitDistribution',
            ${settlement.ledgerAmount},
            ${ledgerNote}
          )
          RETURNING id
        `;
        return { redeemed, ledgerId: ledger.rows[0].id as string };
      });
      redemption = result.redeemed;
      ledgerEntryId = result.ledgerId;
    } catch (error) {
    if (isRedirectError(error)) throw error;
      return { error: error instanceof Error ? error.message : "Failed to settle this claim." };
    }

    await writeAuditEvent("profit_claim.settle", "investor_profit_claims", id, {
      investorId,
      lockedAmount: locked,
      previousSettledAmount: prevSettled,
      settledAmount: settlement.finalSettledAmount,
      paidThisSettlement: settlement.cappedAmount,
      grossThisSettlement,
      feeThisSettlement,
      settledGrossAmount: settledGross,
      unitsRedeemed: redemption.unitsRedeemed,
      navPerUnit: redemption.navPerUnit,
      unitLedgerId: redemption.unitLedgerId,
      cashMovementId: redemption.cashMovementId,
      performanceFeeId: redemption.performanceFeeId,
      brokerageFee,
      status: settlement.status,
      settledDate,
      capitalLedgerId: ledgerEntryId,
    });

    revalidatePath("/claims");
    revalidatePath("/admin-logs");
    revalidatePath("/investors");
    revalidatePath(`/investors/${investorId}`);
    revalidatePath("/reports");
    revalidatePath("/brokerage");
    revalidatePath("/");
    return { success: true, netPaid: settlement.cappedAmount, brokerageFee: settlement.isFullySettled ? brokerageFee : 0 };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("DB Error:", error);
    return { error: "Failed to settle claim." };
  }
}

export async function deleteClaim(id: string) {
  await requireAdmin();
  void id;
  return { error: "Profit claims cannot be hard-deleted. Settle, reverse through audit controls, or create a correcting claim." };
}
