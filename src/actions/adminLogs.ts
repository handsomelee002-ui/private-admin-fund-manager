"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { ensureAuditColumns, writeAuditEvent } from "@/lib/fundDb";

const REVERSIBLE_ACTIONS = new Set([
  "platform_transaction.add",
  "cash_movement.add",
  "fixed_savings.add",
  "bonus_payment.add",
]);

function oppositeMovement(type: string) {
  if (type === "Deposit") return "Withdrawal";
  if (type === "Withdrawal") return "Deposit";
  if (type === "UnitIssue") return "UnitRedemption";
  if (type === "UnitRedemption") return "UnitIssue";
  throw new Error("Unsupported transaction type.");
}

function revalidateFinancialViews(investorId?: string | null, platformId?: string | null) {
  revalidatePath("/");
  revalidatePath("/admin-logs");
  revalidatePath("/capital");
  revalidatePath("/claims");
  revalidatePath("/fixed-savings");
  revalidatePath("/investors");
  revalidatePath("/nav");
  revalidatePath("/reports");
  revalidatePath("/settings");
  revalidatePath("/trading");
  if (investorId) {
    revalidatePath(`/investors/${investorId}`);
  }
  if (platformId) revalidatePath(`/trading/${platformId}`);
}

async function assertNotAlreadyReverted(auditEventId: string) {
  const existing = await sql`
    SELECT id
    FROM audit_events
    WHERE action LIKE '%.revert'
      AND details->>'originalAuditEventId' = ${auditEventId}
    LIMIT 1
  `;
  if (existing.rows.length > 0) {
    throw new Error("This transaction has already been reverted.");
  }
}

async function assertNoLockedNavOnOrAfter(date: string) {
  const locked = await sql`
    SELECT id
    FROM nav_weeks
    WHERE status = 'locked'
      AND week_ending >= ${date}
    LIMIT 1
  `;
  if (locked.rows.length > 0) {
    throw new Error("This transaction cannot be reverted because later locked financial history depends on it. Use a current-period adjustment instead.");
  }
}

export async function getAdminAuditLogs() {
  await requireAdmin();
  await ensureAuditColumns();
  const logs = await sql`
    SELECT
      ae.id,
      ae.actor_id,
      ae.action,
      ae.entity_type,
      ae.entity_id,
      ae.details,
      TO_CHAR(ae.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
      EXISTS (
        SELECT 1
        FROM audit_events reversal
        WHERE reversal.action LIKE '%.revert'
          AND reversal.details->>'originalAuditEventId' = ae.id::text
      ) as has_revert
    FROM audit_events ae
    ORDER BY ae.created_at DESC
    LIMIT 500
  `;
  return logs.rows.map((row: any) => ({
    ...row,
    canRevert: REVERSIBLE_ACTIONS.has(row.action) && !row.has_revert,
  }));
}

async function revertPlatformTransaction(auditEventId: string, entityId: string) {
  const original = await sql`
    SELECT id, platform_id, TO_CHAR(date, 'YYYY-MM-DD') as date, type, amount, realized_profit, notes, audit_status
    FROM platform_transactions
    WHERE id = ${entityId}
  `;
  const tx = original.rows[0];
  if (!tx) throw new Error("Platform transaction not found.");
  if (tx.audit_status !== "active") throw new Error("Only active transactions can be reverted.");

  const latest = await sql`
    SELECT id
    FROM platform_transactions
    WHERE platform_id = ${tx.platform_id}
      AND audit_status = 'active'
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  `;
  if (latest.rows[0]?.id !== tx.id) {
    throw new Error("Only the latest platform transaction can be reverted.");
  }
  await assertNoLockedNavOnOrAfter(tx.date);

  const reversal = await sql`
    INSERT INTO platform_transactions (platform_id, date, type, amount, realized_profit, notes, audit_status, reversal_of_id)
    VALUES (
      ${tx.platform_id},
      CURRENT_DATE,
      ${oppositeMovement(tx.type)},
      ${tx.amount},
      ${tx.realized_profit === null ? null : -Number(tx.realized_profit)},
      ${`Reversal of platform transaction ${tx.id}`},
      'reversal',
      ${tx.id}
    )
    RETURNING id
  `;
  await sql`UPDATE platform_transactions SET audit_status = 'reverted' WHERE id = ${tx.id}`;
  await writeAuditEvent("platform_transaction.revert", "platform_transactions", reversal.rows[0].id, {
    originalAuditEventId: auditEventId,
    originalTransactionId: tx.id,
    reversalTransactionId: reversal.rows[0].id,
    platformId: tx.platform_id,
  });
  revalidateFinancialViews(null, tx.platform_id);
}

async function revertCashMovement(auditEventId: string, entityId: string, details: Record<string, any>) {
  const original = await sql`
    SELECT cm.id, cm.investor_id, cm.nav_week_id, cm.unit_ledger_id, TO_CHAR(cm.date, 'YYYY-MM-DD') as date,
      cm.type, cm.amount, cm.notes, cm.audit_status,
      iul.type as unit_type, iul.units, iul.nav_per_unit, iul.gross_amount
    FROM cash_movements cm
    JOIN investor_unit_ledger iul ON iul.id = cm.unit_ledger_id
    WHERE cm.id = ${entityId}
  `;
  const movement = original.rows[0];
  if (!movement) throw new Error("Investor transaction not found.");
  if (movement.audit_status !== "active") throw new Error("Only active transactions can be reverted.");

  const latestCash = await sql`
    SELECT id
    FROM cash_movements
    WHERE investor_id = ${movement.investor_id}
      AND audit_status = 'active'
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  `;
  if (latestCash.rows[0]?.id !== movement.id) {
    throw new Error("Only the latest investor transaction can be reverted.");
  }
  const laterUnits = await sql`
    SELECT id
    FROM investor_unit_ledger
    WHERE investor_id = ${movement.investor_id}
      AND audit_status = 'active'
      AND (date > ${movement.date} OR (date = ${movement.date} AND id <> ${movement.unit_ledger_id}))
    LIMIT 1
  `;
  if (laterUnits.rows.length > 0) {
    throw new Error("This transaction cannot be reverted because later investor unit activity depends on it.");
  }
  await assertNoLockedNavOnOrAfter(movement.date);

  const unitReversal = await sql`
    INSERT INTO investor_unit_ledger (investor_id, nav_week_id, date, type, units, nav_per_unit, gross_amount, notes, audit_status, reversal_of_id)
    VALUES (
      ${movement.investor_id},
      ${movement.nav_week_id},
      CURRENT_DATE,
      ${oppositeMovement(movement.unit_type)},
      ${movement.units},
      ${movement.nav_per_unit},
      ${movement.gross_amount},
      ${`Reversal of investor unit ledger ${movement.unit_ledger_id}`},
      'reversal',
      ${movement.unit_ledger_id}
    )
    RETURNING id
  `;
  const cashReversal = await sql`
    INSERT INTO cash_movements (investor_id, nav_week_id, unit_ledger_id, date, type, amount, status, notes, audit_status, reversal_of_id)
    VALUES (
      ${movement.investor_id},
      ${movement.nav_week_id},
      ${unitReversal.rows[0].id},
      CURRENT_DATE,
      ${oppositeMovement(movement.type)},
      ${movement.amount},
      'settled',
      ${`Reversal of cash movement ${movement.id}`},
      'reversal',
      ${movement.id}
    )
    RETURNING id
  `;
  await sql`UPDATE cash_movements SET audit_status = 'reverted' WHERE id = ${movement.id}`;
  await sql`UPDATE investor_unit_ledger SET audit_status = 'reverted' WHERE id = ${movement.unit_ledger_id}`;

  if (details.performanceFeeId) {
    await sql`
      UPDATE performance_fees
      SET audit_status = 'reverted'
      WHERE id = ${details.performanceFeeId}
        AND audit_status = 'active'
    `;
  }

  await writeAuditEvent("cash_movement.revert", "cash_movements", cashReversal.rows[0].id, {
    originalAuditEventId: auditEventId,
    originalCashMovementId: movement.id,
    originalUnitLedgerId: movement.unit_ledger_id,
    reversalCashMovementId: cashReversal.rows[0].id,
    reversalUnitLedgerId: unitReversal.rows[0].id,
    investorId: movement.investor_id,
  });
  revalidateFinancialViews(movement.investor_id, null);
}

async function revertFixedSavings(auditEventId: string, entityId: string) {
  const original = await sql`
    SELECT id, account_id, investor_id, TO_CHAR(date, 'YYYY-MM-DD') as date, type, amount, annual_rate_percent, notes, audit_status
    FROM fixed_savings_ledger
    WHERE id = ${entityId}
  `;
  const movement = original.rows[0];
  if (!movement) throw new Error("Fixed savings transaction not found.");
  if (movement.audit_status !== "active") throw new Error("Only active transactions can be reverted.");

  const latest = movement.account_id
    ? await sql`
        SELECT id
        FROM fixed_savings_ledger
        WHERE account_id = ${movement.account_id}
          AND audit_status = 'active'
        ORDER BY date DESC, created_at DESC
        LIMIT 1
      `
    : await sql`
        SELECT id
        FROM fixed_savings_ledger
        WHERE investor_id = ${movement.investor_id}
          AND account_id IS NULL
          AND audit_status = 'active'
        ORDER BY date DESC, created_at DESC
        LIMIT 1
      `;
  if (latest.rows[0]?.id !== movement.id) {
    throw new Error("Only the latest fixed savings movement can be reverted.");
  }

  const reversal = await sql`
    INSERT INTO fixed_savings_ledger (account_id, investor_id, date, type, amount, annual_rate_percent, notes, audit_status, reversal_of_id)
    VALUES (
      ${movement.account_id},
      ${movement.investor_id},
      CURRENT_DATE,
      ${oppositeMovement(movement.type)},
      ${movement.amount},
      ${movement.annual_rate_percent},
      ${`Reversal of fixed savings ledger ${movement.id}`},
      'reversal',
      ${movement.id}
    )
    RETURNING id
  `;
  await sql`UPDATE fixed_savings_ledger SET audit_status = 'reverted' WHERE id = ${movement.id}`;
  if (movement.account_id) {
    await sql`
      UPDATE fixed_savings_accounts
      SET status = CASE WHEN (
        SELECT COALESCE(SUM(CASE WHEN type = 'Deposit' THEN amount WHEN type = 'Withdrawal' THEN -amount ELSE 0 END), 0)
        FROM fixed_savings_ledger
        WHERE account_id = ${movement.account_id}
      ) <= 0 THEN 'closed' ELSE 'active' END
      WHERE id = ${movement.account_id}
    `;
  }
  await writeAuditEvent("fixed_savings.revert", "fixed_savings_ledger", reversal.rows[0].id, {
    originalAuditEventId: auditEventId,
    originalLedgerId: movement.id,
    reversalLedgerId: reversal.rows[0].id,
    investorId: movement.investor_id,
  });
  revalidateFinancialViews(movement.investor_id, null);
}

async function revertBonusPayment(auditEventId: string, entityId: string) {
  const original = await sql`
    SELECT bp.id, bp.investor_id, bp.ledger_type, bp.source_id, bp.amount, TO_CHAR(bp.date, 'YYYY-MM-DD') as date, bp.audit_status,
      iul.nav_week_id, iul.type as unit_type, iul.units, iul.nav_per_unit, iul.gross_amount
    FROM bonus_payments bp
    LEFT JOIN investor_unit_ledger iul ON iul.id = bp.source_id AND bp.ledger_type = 'equity'
    WHERE bp.id = ${entityId}
  `;
  const bonus = original.rows[0];
  if (!bonus) throw new Error("Bonus payment not found.");
  if (bonus.audit_status !== "active") throw new Error("Only active bonus payments can be reverted.");
  if (bonus.ledger_type !== "equity") {
    throw new Error("Only equity bonus reversal is supported by this revert action.");
  }
  const latest = await sql`
    SELECT id
    FROM investor_unit_ledger
    WHERE investor_id = ${bonus.investor_id}
      AND audit_status = 'active'
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  `;
  if (latest.rows[0]?.id !== bonus.source_id) {
    throw new Error("Only the latest equity bonus movement can be reverted.");
  }
  await assertNoLockedNavOnOrAfter(bonus.date);

  const unitReversal = await sql`
    INSERT INTO investor_unit_ledger (investor_id, nav_week_id, date, type, units, nav_per_unit, gross_amount, notes, audit_status, reversal_of_id)
    VALUES (
      ${bonus.investor_id},
      ${bonus.nav_week_id},
      CURRENT_DATE,
      ${oppositeMovement(bonus.unit_type)},
      ${bonus.units},
      ${bonus.nav_per_unit},
      ${bonus.gross_amount},
      ${`Reversal of equity bonus ${bonus.id}`},
      'reversal',
      ${bonus.source_id}
    )
    RETURNING id
  `;
  await sql`UPDATE bonus_payments SET audit_status = 'reverted' WHERE id = ${bonus.id}`;
  await sql`UPDATE investor_unit_ledger SET audit_status = 'reverted' WHERE id = ${bonus.source_id}`;
  await writeAuditEvent("bonus_payment.revert", "bonus_payments", unitReversal.rows[0].id, {
    originalAuditEventId: auditEventId,
    originalBonusPaymentId: bonus.id,
    originalUnitLedgerId: bonus.source_id,
    reversalUnitLedgerId: unitReversal.rows[0].id,
    investorId: bonus.investor_id,
  });
  revalidateFinancialViews(bonus.investor_id, null);
}

export async function revertAuditLog(id: string) {
  try {
    await requireAdmin();
    await ensureAuditColumns();
    await assertNotAlreadyReverted(id);

    const event = await sql`
      SELECT id, action, entity_type, entity_id, details
      FROM audit_events
      WHERE id = ${id}
    `;
    const row = event.rows[0];
    if (!row || !REVERSIBLE_ACTIONS.has(row.action) || !row.entity_id) {
      return { error: "This audit log cannot be reverted." };
    }

    if (row.action === "platform_transaction.add") {
      await revertPlatformTransaction(id, row.entity_id);
    } else if (row.action === "cash_movement.add") {
      await revertCashMovement(id, row.entity_id, row.details ?? {});
    } else if (row.action === "fixed_savings.add") {
      await revertFixedSavings(id, row.entity_id);
    } else if (row.action === "bonus_payment.add") {
      await revertBonusPayment(id, row.entity_id);
    }

    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to revert audit log." };
  }
}
