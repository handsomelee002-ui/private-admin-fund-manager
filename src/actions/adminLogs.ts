"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { isRedirectError, requireAdmin } from "@/lib/auth";
import { ensureAuditColumns, withTransaction, writeAuditEvent } from "@/lib/fundDb";

const REVERSIBLE_ACTION_LIST = [
  "platform_transaction.add",
  "cash_movement.add",
  "fixed_savings.add",
  "bonus_payment.add",
] as const;
const REVERSIBLE_ACTIONS = new Set<string>(REVERSIBLE_ACTION_LIST);
type AdminLogStatusFilter = "all" | "active" | "blocked" | "reverted" | "reversal";

const REVERT_REASONS = {
  unsupported: "This audit event is informational or structural history and cannot be reverted.",
  reversalRecord: "Reversal records are audit evidence and cannot be reverted.",
  alreadyReverted: "This event has already been reverted.",
  missingEntity: "The source financial record no longer exists, so this audit event cannot be safely reverted.",
  inactiveEntity: "Only active financial records can be reverted.",
  platformLatest: "Only the latest active platform transaction for the platform can be reverted.",
  investorLatestCash: "Only the latest active investor cash movement for the investor can be reverted.",
  laterInvestorUnits: "Later investor unit activity depends on this cash movement.",
  fixedSavingsLatest: "Only the latest active fixed-savings movement for the account or legacy investor balance can be reverted.",
  fixedSavingsBonus: "Fixed-savings bonus reversal is not implemented; use an explicit current-period adjustment.",
  equityBonusLatest: "Only the latest active equity bonus unit movement for the investor can be reverted.",
  lockedHistory: "Later locked financial history depends on this record; use a current-period adjustment instead.",
} as const;

type RevertEligibility = {
  canRevert: boolean;
  revertSupport: string;
};

function collectEntityIds(rows: any[], entityType: string) {
  return rows
    .filter((row) => row.entity_type === entityType && row.entity_id)
    .map((row) => row.entity_id);
}

function uniqueIds(ids: unknown[]) {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

async function lookupById(query: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, any>();
  const result = await sql.query(query, [ids]);
  return new Map(result.rows.map((row: any) => [row.id, row]));
}

async function latestLockedNavWeekEnding() {
  const result = await sql`SELECT TO_CHAR(MAX(week_ending), 'YYYY-MM-DD') as week_ending FROM nav_weeks WHERE status = 'locked'`;
  return result.rows[0]?.week_ending as string | null;
}

function lockedNavDependsOn(date: string | null | undefined, latestLockedWeekEnding: string | null) {
  return Boolean(date && latestLockedWeekEnding && latestLockedWeekEnding >= date);
}

function auditStatus(row: any): Exclude<AdminLogStatusFilter, "all"> {
  if (row.action.endsWith(".revert")) return "reversal";
  if (row.has_revert) return "reverted";
  if (!row.canRevert) return "blocked";
  return "active";
}

async function latestActivePlatformTransactionIds(platformIds: string[]) {
  if (platformIds.length === 0) return new Map<string, string>();
  const result = await sql.query(`
    SELECT DISTINCT ON (platform_id) platform_id, id
    FROM platform_transactions
    WHERE platform_id = ANY($1::uuid[])
      AND audit_status = 'active'
    ORDER BY platform_id, date DESC, created_at DESC
  `, [platformIds]);
  return new Map(result.rows.map((row: any) => [row.platform_id, row.id]));
}

async function latestActiveCashMovementIds(investorIds: string[]) {
  if (investorIds.length === 0) return new Map<string, string>();
  const result = await sql.query(`
    SELECT DISTINCT ON (investor_id) investor_id, id
    FROM cash_movements
    WHERE investor_id = ANY($1::uuid[])
      AND audit_status = 'active'
    ORDER BY investor_id, date DESC, created_at DESC
  `, [investorIds]);
  return new Map(result.rows.map((row: any) => [row.investor_id, row.id]));
}

async function cashMovementsWithLaterUnitActivity(cashMovementIds: string[]) {
  if (cashMovementIds.length === 0) return new Set<string>();
  const result = await sql.query(`
    SELECT cm.id
    FROM cash_movements cm
    JOIN investor_unit_ledger source_iul ON source_iul.id = cm.unit_ledger_id
    WHERE cm.id = ANY($1::uuid[])
      AND EXISTS (
        SELECT 1
        FROM investor_unit_ledger iul
        WHERE iul.investor_id = cm.investor_id
          AND iul.audit_status = 'active'
          AND iul.id <> cm.unit_ledger_id
          AND (
            iul.date > cm.date
            OR (iul.date = cm.date AND iul.created_at > source_iul.created_at)
          )
      )
  `, [cashMovementIds]);
  return new Set(result.rows.map((row: any) => row.id as string));
}

async function latestActiveFixedSavingsLedgerIds(rows: any[]) {
  const accountIds = uniqueIds(rows.map((row) => row.account_id));
  const legacyInvestorIds = uniqueIds(rows.filter((row) => !row.account_id).map((row) => row.investor_id));
  const latest = new Map<string, string>();

  if (accountIds.length > 0) {
    const result = await sql.query(`
      SELECT DISTINCT ON (account_id) account_id, id
      FROM fixed_savings_ledger
      WHERE account_id = ANY($1::uuid[])
        AND audit_status = 'active'
      ORDER BY account_id, date DESC, created_at DESC
    `, [accountIds]);
    for (const row of result.rows as any[]) latest.set(`account:${row.account_id}`, row.id);
  }

  if (legacyInvestorIds.length > 0) {
    const result = await sql.query(`
      SELECT DISTINCT ON (investor_id) investor_id, id
      FROM fixed_savings_ledger
      WHERE investor_id = ANY($1::uuid[])
        AND account_id IS NULL
        AND audit_status = 'active'
      ORDER BY investor_id, date DESC, created_at DESC
    `, [legacyInvestorIds]);
    for (const row of result.rows as any[]) latest.set(`legacy:${row.investor_id}`, row.id);
  }

  return latest;
}

async function latestActiveInvestorUnitLedgerIds(investorIds: string[]) {
  if (investorIds.length === 0) return new Map<string, string>();
  const result = await sql.query(`
    SELECT DISTINCT ON (investor_id) investor_id, id
    FROM investor_unit_ledger
    WHERE investor_id = ANY($1::uuid[])
      AND audit_status = 'active'
    ORDER BY investor_id, date DESC, created_at DESC
  `, [investorIds]);
  return new Map(result.rows.map((row: any) => [row.investor_id, row.id]));
}

function decorateAuditLogRows(rows: any[]) {
  return rows.map((row) => ({
    ...row,
    canRequestRevert: REVERSIBLE_ACTIONS.has(row.action) && !row.has_revert && !row.action.endsWith(".revert") && Boolean(row.entity_id),
    canRevert: undefined,
    revertSupport: REVERSIBLE_ACTIONS.has(row.action)
      ? "Revert eligibility is checked when you click Revert or open the details."
      : REVERT_REASONS.unsupported,
  }));
}

async function enrichAuditLogs(rows: any[], { includeReadableDetails = true, includeEligibility = true } = {}) {
  const platformTransactions = await lookupById(`
    SELECT pt.id, pt.platform_id, TO_CHAR(pt.date, 'YYYY-MM-DD') as date, pt.type, pt.amount, pt.currency, pt.base_amount,
      pt.status, pt.audit_status, p.name as platform_name, pa.name as account_name, passet.symbol as asset_symbol
    FROM platform_transactions pt
    LEFT JOIN platforms p ON p.id = pt.platform_id
    LEFT JOIN platform_accounts pa ON pa.id = pt.account_id
    LEFT JOIN platform_assets passet ON passet.id = pt.asset_id
    WHERE pt.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "platform_transactions"));
  const cashMovements = await lookupById(`
    SELECT cm.id, cm.investor_id, cm.unit_ledger_id, TO_CHAR(cm.date, 'YYYY-MM-DD') as date, cm.type, cm.amount, cm.status,
      cm.audit_status,
      i.name as investor_name, TO_CHAR(nw.week_ending, 'YYYY-MM-DD') as nav_week_ending
    FROM cash_movements cm
    LEFT JOIN investors i ON i.id = cm.investor_id
    LEFT JOIN nav_weeks nw ON nw.id = cm.nav_week_id
    WHERE cm.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "cash_movements"));
  const fixedSavings = await lookupById(`
    SELECT fsl.id, fsl.account_id, fsl.investor_id, TO_CHAR(fsl.date, 'YYYY-MM-DD') as date, fsl.type, fsl.amount, fsl.annual_rate_percent,
      fsl.audit_status,
      i.name as investor_name, fsa.status as account_status
    FROM fixed_savings_ledger fsl
    LEFT JOIN investors i ON i.id = fsl.investor_id
    LEFT JOIN fixed_savings_accounts fsa ON fsa.id = fsl.account_id
    WHERE fsl.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "fixed_savings_ledger"));
  const bonusPayments = await lookupById(`
    SELECT bp.id, bp.investor_id, bp.ledger_type, bp.source_id, bp.amount, TO_CHAR(bp.date, 'YYYY-MM-DD') as date,
      bp.audit_status,
      i.name as investor_name
    FROM bonus_payments bp
    LEFT JOIN investors i ON i.id = bp.investor_id
    WHERE bp.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "bonus_payments"));
  const navWeeks = await lookupById(`
    SELECT id, TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending, status, nav_per_unit, net_asset_value
    FROM nav_weeks
    WHERE id = ANY($1::uuid[])
  `, collectEntityIds(rows, "nav_weeks"));
  const platformAccounts = await lookupById(`
    SELECT pa.id, pa.name, pa.account_type, pa.currency, p.name as platform_name
    FROM platform_accounts pa
    LEFT JOIN platforms p ON p.id = pa.platform_id
    WHERE pa.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "platform_accounts"));
  const platformAssets = await lookupById(`
    SELECT passet.id, passet.symbol, passet.name, passet.asset_type, passet.currency, p.name as platform_name
    FROM platform_assets passet
    LEFT JOIN platforms p ON p.id = passet.platform_id
    WHERE passet.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "platform_assets"));
  const profitClaims = await lookupById(`
    SELECT ipc.id, ipc.investor_id, ipc.locked_amount, ipc.settled_amount, ipc.brokerage_fee, ipc.status,
      TO_CHAR(ipc.claim_date, 'YYYY-MM-DD') as claim_date,
      TO_CHAR(ipc.settled_date, 'YYYY-MM-DD') as settled_date,
      i.name as investor_name
    FROM investor_profit_claims ipc
    LEFT JOIN investors i ON i.id = ipc.investor_id
    WHERE ipc.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "investor_profit_claims"));
  const platformValuations = await lookupById(`
    SELECT pv.id, pv.platform_id, TO_CHAR(pv.as_of_date, 'YYYY-MM-DD') as as_of_date,
      pv.total_value, pv.source, pv.audit_status, p.name as platform_name
    FROM platform_valuations pv
    LEFT JOIN platforms p ON p.id = pv.platform_id
    WHERE pv.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "platform_valuations"));
  const fundCashValuations = await lookupById(`
    SELECT fcv.id, TO_CHAR(fcv.as_of_date, 'YYYY-MM-DD') as as_of_date,
      fcv.balance, fcv.audit_status
    FROM fund_cash_valuations fcv
    WHERE fcv.id = ANY($1::uuid[])
  `, collectEntityIds(rows, "fund_cash_valuations"));

  const detailInvestorIds = uniqueIds(rows.map((row) => row.details?.investorId));
  const detailPlatformIds = uniqueIds(rows.map((row) => row.details?.platformId));
  const investors = await lookupById("SELECT id, name FROM investors WHERE id = ANY($1::uuid[])", detailInvestorIds);
  const platforms = await lookupById("SELECT id, name FROM platforms WHERE id = ANY($1::uuid[])", detailPlatformIds);
  const latestLockedWeekEnding = includeEligibility ? await latestLockedNavWeekEnding() : null;
  const platformLatestIds = includeEligibility ? await latestActivePlatformTransactionIds(uniqueIds([...platformTransactions.values()].map((row: any) => row.platform_id))) : new Map<string, string>();
  const cashLatestIds = includeEligibility ? await latestActiveCashMovementIds(uniqueIds([...cashMovements.values()].map((row: any) => row.investor_id))) : new Map<string, string>();
  const cashIdsWithLaterUnits = includeEligibility ? await cashMovementsWithLaterUnitActivity([...cashMovements.keys()]) : new Set<string>();
  const fixedSavingsLatestIds = includeEligibility ? await latestActiveFixedSavingsLedgerIds([...fixedSavings.values()]) : new Map<string, string>();
  const investorLatestUnitLedgerIds = includeEligibility ? await latestActiveInvestorUnitLedgerIds(uniqueIds([...bonusPayments.values()].map((row: any) => row.investor_id))) : new Map<string, string>();

  function eligibility(row: any, entity: any): RevertEligibility {
    if (row.action.endsWith(".revert")) return { canRevert: false, revertSupport: REVERT_REASONS.reversalRecord };
    if (row.has_revert) return { canRevert: false, revertSupport: REVERT_REASONS.alreadyReverted };
    if (!REVERSIBLE_ACTIONS.has(row.action) || !row.entity_id) return { canRevert: false, revertSupport: REVERT_REASONS.unsupported };
    if (!entity) return { canRevert: false, revertSupport: REVERT_REASONS.missingEntity };
    if (entity.audit_status !== "active") return { canRevert: false, revertSupport: REVERT_REASONS.inactiveEntity };

    if (row.action === "platform_transaction.add") {
      if (platformLatestIds.get(entity.platform_id) !== entity.id) return { canRevert: false, revertSupport: REVERT_REASONS.platformLatest };
      if (lockedNavDependsOn(entity.date, latestLockedWeekEnding)) return { canRevert: false, revertSupport: REVERT_REASONS.lockedHistory };
      return { canRevert: true, revertSupport: "Able to revert: this is the latest active platform transaction and no locked NAV depends on its date." };
    }

    if (row.action === "cash_movement.add") {
      if (cashLatestIds.get(entity.investor_id) !== entity.id) return { canRevert: false, revertSupport: REVERT_REASONS.investorLatestCash };
      if (cashIdsWithLaterUnits.has(entity.id)) return { canRevert: false, revertSupport: REVERT_REASONS.laterInvestorUnits };
      if (lockedNavDependsOn(entity.date, latestLockedWeekEnding)) return { canRevert: false, revertSupport: REVERT_REASONS.lockedHistory };
      return { canRevert: true, revertSupport: "Able to revert: this is the latest active investor cash movement, no later unit activity depends on it, and no locked NAV depends on its date." };
    }

    if (row.action === "fixed_savings.add") {
      const latestKey = entity.account_id ? `account:${entity.account_id}` : `legacy:${entity.investor_id}`;
      if (fixedSavingsLatestIds.get(latestKey) !== entity.id) return { canRevert: false, revertSupport: REVERT_REASONS.fixedSavingsLatest };
      return { canRevert: true, revertSupport: "Able to revert: this is the latest active fixed-savings movement for the account or legacy investor balance." };
    }

    if (row.action === "bonus_payment.add") {
      if (entity.ledger_type !== "equity") return { canRevert: false, revertSupport: REVERT_REASONS.fixedSavingsBonus };
      if (investorLatestUnitLedgerIds.get(entity.investor_id) !== entity.source_id) return { canRevert: false, revertSupport: REVERT_REASONS.equityBonusLatest };
      if (lockedNavDependsOn(entity.date, latestLockedWeekEnding)) return { canRevert: false, revertSupport: REVERT_REASONS.lockedHistory };
      return { canRevert: true, revertSupport: "Able to revert: this is the latest active equity bonus unit movement and no locked NAV depends on its date." };
    }

    return { canRevert: false, revertSupport: REVERT_REASONS.unsupported };
  }

  return rows.map((row) => {
    const details = row.details ?? {};
    const readable: Record<string, unknown> = {};
    const entityLookup = {
      platform_transactions: platformTransactions,
      cash_movements: cashMovements,
      fixed_savings_ledger: fixedSavings,
      bonus_payments: bonusPayments,
      nav_weeks: navWeeks,
      platform_accounts: platformAccounts,
      platform_assets: platformAssets,
      investor_profit_claims: profitClaims,
      platform_valuations: platformValuations,
      fund_cash_valuations: fundCashValuations,
    }[row.entity_type as string];
    const entity = entityLookup?.get(row.entity_id);
    if (includeReadableDetails) {
      if (entity) readable.entity = entity;
      if (details.investorId && investors.has(details.investorId)) readable.investor = investors.get(details.investorId);
      if (details.platformId && platforms.has(details.platformId)) readable.platform = platforms.get(details.platformId);
      if (row.action === "bonus_payment.add" && details.ledgerType === "fixed_savings") {
        readable.revertNote = "Fixed-savings bonus revert is not implemented; use an explicit current-period adjustment until this reversal path is added.";
      }
    }
    const revertEligibility = includeEligibility ? eligibility(row, entity) : null;
    return {
      ...row,
      canRequestRevert: REVERSIBLE_ACTIONS.has(row.action) && !row.has_revert && !row.action.endsWith(".revert") && Boolean(row.entity_id),
      readableDetails: includeReadableDetails ? readable : undefined,
      canRevert: revertEligibility?.canRevert,
      revertSupport: revertEligibility?.revertSupport ?? (
        REVERSIBLE_ACTIONS.has(row.action)
          ? "Revert eligibility is checked when you click Revert or open the details."
          : REVERT_REASONS.unsupported
      ),
    };
  });
}

function oppositeMovement(type: string) {
  if (type === "Deposit") return "Withdrawal";
  if (type === "Withdrawal") return "Deposit";
  if (type === "BROKER_DEPOSIT") return "BROKER_WITHDRAWAL";
  if (type === "BROKER_WITHDRAWAL") return "BROKER_DEPOSIT";
  if (type === "BUY") return "SELL";
  if (type === "SELL") return "BUY";
  if (type === "UnitIssue") return "UnitRedemption";
  if (type === "UnitRedemption") return "UnitIssue";
  return "ADJUSTMENT";
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
  revalidatePath("/brokerage");
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
    throw new Error(REVERT_REASONS.alreadyReverted);
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
    throw new Error(REVERT_REASONS.lockedHistory);
  }
}

async function getPagedAuditRows(status: Extract<AdminLogStatusFilter, "all" | "reverted" | "reversal">, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const statusWhere = {
    all: "",
    reverted: "WHERE has_revert = true AND action NOT LIKE '%.revert'",
    reversal: "WHERE action LIKE '%.revert'",
  }[status];
  const countQuery = status === "all"
    ? sql.query("SELECT COUNT(*)::int as count FROM audit_events")
    : sql.query(`
      SELECT COUNT(*)::int as count
      FROM (
        SELECT ae.action,
          EXISTS (
            SELECT 1
            FROM audit_events reversal
            WHERE reversal.action LIKE '%.revert'
              AND reversal.details->>'originalAuditEventId' = ae.id::text
          ) as has_revert
        FROM audit_events ae
      ) logs
      ${statusWhere}
    `);
  const logsQuery = sql.query(`
    SELECT id, actor_id, action, entity_type, entity_id, details, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at, has_revert
    FROM (
      SELECT
        ae.id,
        ae.actor_id,
        ae.action,
        ae.entity_type,
        ae.entity_id,
        ae.details,
        ae.created_at,
        EXISTS (
          SELECT 1
          FROM audit_events reversal
          WHERE reversal.action LIKE '%.revert'
            AND reversal.details->>'originalAuditEventId' = ae.id::text
        ) as has_revert
      FROM audit_events ae
    ) logs
    ${statusWhere}
    ORDER BY logs.created_at DESC
    LIMIT $1 OFFSET $2
  `, [pageSize, offset]);
  const [count, logs] = await Promise.all([countQuery, logsQuery]);
  return { rows: logs.rows, total: Number(count.rows[0]?.count || 0) };
}

async function getEligibleAuditRows(status: Extract<AdminLogStatusFilter, "active" | "blocked">, page: number, pageSize: number) {
  const candidateLimit = 500;
  const candidates = await sql.query(`
    SELECT
      ae.id,
      ae.actor_id,
      ae.action,
      ae.entity_type,
      ae.entity_id,
      ae.details,
      TO_CHAR(ae.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
      false as has_revert
    FROM audit_events ae
    WHERE ae.action = ANY($1::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM audit_events reversal
        WHERE reversal.action LIKE '%.revert'
          AND reversal.details->>'originalAuditEventId' = ae.id::text
      )
    ORDER BY ae.created_at DESC
    LIMIT $2
  `, [REVERSIBLE_ACTION_LIST, candidateLimit]);
  const enriched = await enrichAuditLogs(candidates.rows, { includeReadableDetails: false });
  const filtered = enriched.filter((row) => auditStatus(row) === status);
  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
  };
}

export async function getAdminAuditLogs({
  status = "all",
  page = 1,
  pageSize = 12,
}: {
  status?: AdminLogStatusFilter;
  page?: number;
  pageSize?: number;
} = {}) {
  await requireAdmin();
  await ensureAuditColumns();
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 50 ? pageSize : 12;
  if (status === "active" || status === "blocked") {
    const result = await getEligibleAuditRows(status, safePage, safePageSize);
    return { logs: result.rows, total: result.total };
  }
  const result = await getPagedAuditRows(status, safePage, safePageSize);
  return { logs: decorateAuditLogRows(result.rows), total: result.total };
}

export async function getAdminAuditLogDetails(id: string) {
  await requireAdmin();
  await ensureAuditColumns();
  const result = await sql`
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
    WHERE ae.id = ${id}
    LIMIT 1
  `;
  if (!result.rows[0]) return { error: "Audit log not found." };
  const [log] = await enrichAuditLogs(result.rows, { includeReadableDetails: true });
  return { log };
}

async function revertPlatformTransaction(auditEventId: string, entityId: string) {
  const original = await sql`
    SELECT id, platform_id, account_id, asset_id, TO_CHAR(date, 'YYYY-MM-DD') as date, type, amount, currency, base_currency,
      base_amount, fx_rate_to_base, quantity, price_per_unit, gross_amount, fee_amount, tax_amount, net_amount,
      realized_profit, reference, status, notes, audit_status
    FROM platform_transactions
    WHERE id = ${entityId}
  `;
  const tx = original.rows[0];
  if (!tx) throw new Error("Platform transaction not found.");
  if (tx.audit_status !== "active") throw new Error(REVERT_REASONS.inactiveEntity);

  const latest = await sql`
    SELECT id
    FROM platform_transactions
    WHERE platform_id = ${tx.platform_id}
      AND audit_status = 'active'
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  `;
  if (latest.rows[0]?.id !== tx.id) {
    throw new Error(REVERT_REASONS.platformLatest);
  }
  await assertNoLockedNavOnOrAfter(tx.date);

  // Writing the reversal and marking the original reverted must be one unit:
  // either alone leaves the ledger double-counting or silently unreversed.
  await withTransaction(async (db) => {
  const reversal = await db`
    INSERT INTO platform_transactions (
      platform_id, account_id, asset_id, date, type, amount, currency, base_currency, base_amount,
      fx_rate_to_base, quantity, price_per_unit, gross_amount, fee_amount, tax_amount, net_amount,
      realized_profit, reference, status, notes, audit_status, reversal_of_id
    )
    VALUES (
      ${tx.platform_id},
      ${tx.account_id},
      ${tx.asset_id},
      CURRENT_DATE,
      ${oppositeMovement(tx.type)},
      ${tx.amount},
      ${tx.currency},
      ${tx.base_currency},
      ${tx.base_amount},
      ${tx.fx_rate_to_base},
      ${tx.quantity},
      ${tx.price_per_unit},
      ${tx.gross_amount},
      ${tx.fee_amount},
      ${tx.tax_amount},
      ${tx.net_amount},
      ${tx.realized_profit === null ? null : -Number(tx.realized_profit)},
      ${tx.reference},
      ${tx.status},
      ${`Reversal of platform transaction ${tx.id}`},
      'reversal',
      ${tx.id}
    )
    RETURNING id
  `;
  await db`UPDATE platform_transactions SET audit_status = 'reverted' WHERE id = ${tx.id}`;
  await writeAuditEvent("platform_transaction.revert", "platform_transactions", reversal.rows[0].id, {
    originalAuditEventId: auditEventId,
    originalTransactionId: tx.id,
    reversalTransactionId: reversal.rows[0].id,
    platformId: tx.platform_id,
  }, db);
  });
  revalidateFinancialViews(null, tx.platform_id);
}

async function revertCashMovement(auditEventId: string, entityId: string, details: Record<string, any>) {
  const original = await sql`
    SELECT cm.id, cm.investor_id, cm.nav_week_id, cm.unit_ledger_id, TO_CHAR(cm.date, 'YYYY-MM-DD') as date,
      cm.type, cm.amount, cm.notes, cm.audit_status,
      iul.type as unit_type, iul.units, iul.nav_per_unit, iul.gross_amount, iul.created_at as unit_created_at
    FROM cash_movements cm
    JOIN investor_unit_ledger iul ON iul.id = cm.unit_ledger_id
    WHERE cm.id = ${entityId}
  `;
  const movement = original.rows[0];
  if (!movement) throw new Error("Investor transaction not found.");
  if (movement.audit_status !== "active") throw new Error(REVERT_REASONS.inactiveEntity);

  const latestCash = await sql`
    SELECT id
    FROM cash_movements
    WHERE investor_id = ${movement.investor_id}
      AND audit_status = 'active'
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  `;
  if (latestCash.rows[0]?.id !== movement.id) {
    throw new Error(REVERT_REASONS.investorLatestCash);
  }
  const laterUnits = await sql`
    SELECT iul.id
    FROM investor_unit_ledger iul
    JOIN investor_unit_ledger source_iul ON source_iul.id = ${movement.unit_ledger_id}
    WHERE iul.investor_id = ${movement.investor_id}
      AND iul.audit_status = 'active'
      AND iul.id <> ${movement.unit_ledger_id}
      AND (
        iul.date > ${movement.date}
        OR (iul.date = ${movement.date} AND iul.created_at > source_iul.created_at)
      )
    LIMIT 1
  `;
  if (laterUnits.rows.length > 0) {
    throw new Error(REVERT_REASONS.laterInvestorUnits);
  }
  await assertNoLockedNavOnOrAfter(movement.date);

  await withTransaction(async (db) => {
  const unitReversal = await db`
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
  const cashReversal = await db`
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
  await db`UPDATE cash_movements SET audit_status = 'reverted' WHERE id = ${movement.id}`;
  await db`UPDATE investor_unit_ledger SET audit_status = 'reverted' WHERE id = ${movement.unit_ledger_id}`;

  if (details.performanceFeeId) {
    await db`
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
  }, db);
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
  if (movement.audit_status !== "active") throw new Error(REVERT_REASONS.inactiveEntity);

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
    throw new Error(REVERT_REASONS.fixedSavingsLatest);
  }

  await withTransaction(async (db) => {
  const reversal = await db`
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
  await db`UPDATE fixed_savings_ledger SET audit_status = 'reverted' WHERE id = ${movement.id}`;
  if (movement.account_id) {
    await db`
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
  }, db);
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
  if (bonus.audit_status !== "active") throw new Error(REVERT_REASONS.inactiveEntity);
  if (bonus.ledger_type !== "equity") {
    throw new Error(REVERT_REASONS.fixedSavingsBonus);
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
    throw new Error(REVERT_REASONS.equityBonusLatest);
  }
  await assertNoLockedNavOnOrAfter(bonus.date);

  await withTransaction(async (db) => {
  const unitReversal = await db`
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
  await db`UPDATE bonus_payments SET audit_status = 'reverted' WHERE id = ${bonus.id}`;
  await db`UPDATE investor_unit_ledger SET audit_status = 'reverted' WHERE id = ${bonus.source_id}`;
  await writeAuditEvent("bonus_payment.revert", "bonus_payments", unitReversal.rows[0].id, {
    originalAuditEventId: auditEventId,
    originalBonusPaymentId: bonus.id,
    originalUnitLedgerId: bonus.source_id,
    reversalUnitLedgerId: unitReversal.rows[0].id,
    investorId: bonus.investor_id,
  }, db);
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
      return { error: REVERT_REASONS.unsupported };
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
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to revert audit log." };
  }
}
