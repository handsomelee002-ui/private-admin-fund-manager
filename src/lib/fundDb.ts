import { createClient, sql, type QueryResult, type QueryResultRow } from "@vercel/postgres";
import { createHash, randomUUID } from "node:crypto";
import {
  allocateSharePercentages,
  calculateBrokerageFundingAllocation,
  calculateEquityFundCash,
  calculateNavPerUnit,
  calculateOwnershipPercent,
  issueUnitsForDeposit,
  redeemUnitsForWithdrawal,
  roundMoney,
  roundUnits,
  splitNonEquityProfit,
  splitPoolAvailability,
} from "@/lib/accounting";
import { requireAdmin } from "@/lib/auth";
import { BACKUP_TABLES, assertBackupTableName } from "@/lib/backupTables";
import {
  MATERIAL_WEIGHT_PERCENT,
  STALE_AFTER_DAYS,
  blockingValuations,
  daysBetween,
  resolvePlatformValue,
} from "@/lib/platformValuation";
import type { ResolvedValuation } from "@/lib/platformValuation";

export type CashMovementType = "Deposit" | "Withdrawal";
export type NavStatus = "draft" | "locked";

type NavWeekInput = {
  weekEnding: string;
  settlementDate?: string;
  /**
   * Optional per-platform overrides. Omit to value every platform from its
   * recorded value marks, carried forward when not refreshed.
   */
  platformSnapshots?: PlatformSnapshotInput[];
  /**
   * The fund's own cash balance to price this NAV with. Omit to carry the last
   * recorded balance forward.
   */
  fundCash?: number;
  /**
   * Whether fundCash is a balance the admin actually checked against the bank,
   * rather than the ledger-derived figure the review screen pre-fills. Only a
   * checked balance is worth recording as a new bank anchor.
   */
  fundCashConfirmed?: boolean;
  adjustments: number;
  notes?: string;
};

/**
 * A manual override for one platform. Give either the total value (what the
 * NAV review screen collects) or the unrealized profit relative to net
 * invested; totalValue wins when both are present.
 */
type PlatformSnapshotInput = {
  platformId: string;
  totalValue?: number;
  unrealizedProfit?: number;
};

export type PlatformValuationSource = "MANUAL" | "STATEMENT" | "IMPORT" | "NAV_REVIEW";

export type NavPlatformPreview = ResolvedValuation & {
  platformId: string;
  platformName: string;
  netInvested: number;
  equityNetInvested: number;
  fixedSavingsNetInvested: number;
  brokerageNetInvested: number;
  equityContributed: number;
  fixedSavingsContributed: number;
  brokerageContributed: number;
  profitLoss: number;
  weightPercent: number;
};

export type FundCashPreview = {
  balance: number;
  source: "RECORDED" | "CARRIED_FORWARD" | "NEVER_RECORDED";
  asOfDate: string | null;
  ageDays: number | null;
  isStale: boolean;
  /** What the ledgers imply the balance should be, for comparison. */
  expectedBalance: number;
};

type CashMovementInput = {
  investorId: string;
  date: string;
  type: CashMovementType;
  amount: number;
  withdrawAll?: boolean;
  notes?: string;
};

type FixedSavingsLedgerRow = {
  investor_id?: string;
  id?: string;
  account_id?: string | null;
  withdrawal_batch_id?: string | null;
  date: string;
  type: string;
  amount: string | number;
  annual_rate_percent?: string | number | null;
  interest_rate?: string | number | null;
  audit_status?: string | null;
};

type EquityUnitLedgerRow = {
  date: string;
  type: string;
  units: string | number;
  gross_amount: string | number;
  is_bonus?: boolean | string | number | null;
  audit_status?: string | null;
};

type FixedSavingsInput = {
  investorId: string;
  date: string;
  type: "Deposit" | "Withdrawal";
  amount: number;
  notes?: string;
};

export type FixedSavingsBaseRateRow = {
  id?: string;
  effective_date: string;
  annual_rate_percent: string | number;
  created_at?: string;
};

export type FixedSavingsPromotionRow = {
  id?: string;
  name: string;
  start_date: string;
  end_date: string;
  annual_rate_percent: string | number;
  balance_cap?: string | number | null;
  status: string;
  notes?: string | null;
  created_at?: string;
};

export type FixedSavingsRateInput = {
  baseRates: FixedSavingsBaseRateRow[];
  promotions: FixedSavingsPromotionRow[];
};

type PortalAccessMeta = {
  clientKey: string;
  userAgent?: string;
};

type SeedPlatformTransactionInput = {
  platformId: string;
  accountId?: string | null;
  assetId?: string | null;
  date: string;
  type: string;
  amount: number;
  currency?: string;
  baseAmount?: number;
  fxRateToBase?: number;
  quantity?: number | null;
  pricePerUnit?: number | null;
  grossAmount?: number | null;
  feeAmount?: number;
  taxAmount?: number;
  netAmount?: number | null;
  realizedProfit?: number | null;
  reference: string;
  settlementDate?: string | null;
  notes: string;
  allocations?: { fundingSource: "equity" | "fixed_savings" | "brokerage"; ratioPercent: number; baseAmount: number }[];
};

function calculateCurrentEquityNav(latestNav: any, totalUnits: number) {
  if (!latestNav) return 0;
  return roundMoney(totalUnits * parseFloat(latestNav.nav_per_unit || "0"));
}

function fixedSavingsActivityRow(movement: any) {
  return {
    id: `savings-${movement.id}`,
    date: movement.date,
    category: "Fixed Savings",
    type: movement.type,
    amount: parseFloat(movement.amount || "0"),
    units: null,
    navPerUnit: null,
    annualRatePercent: movement.type === "Deposit" && movement.effective_annual_rate_percent != null
      ? parseFloat(movement.effective_annual_rate_percent || "0")
      : null,
    notes: movement.notes,
    auditStatus: movement.audit_status,
    createdAt: movement.created_at,
  };
}

function fixedSavingsActivityLedger(rows: any[]) {
  const groupedWithdrawals = new Map<string, any>();
  const activityRows: any[] = [];

  for (const movement of rows.filter((row: any) => row.type !== "Bonus")) {
    if (movement.type !== "Withdrawal" || !movement.withdrawal_batch_id) {
      activityRows.push(fixedSavingsActivityRow(movement));
      continue;
    }

    const key = String(movement.withdrawal_batch_id);
    const existing = groupedWithdrawals.get(key);
    if (!existing) {
      groupedWithdrawals.set(key, {
        ...fixedSavingsActivityRow(movement),
        id: `savings-withdrawal-${key}`,
        amount: roundMoney(parseFloat(movement.amount || "0")),
      });
      continue;
    }

    existing.amount = roundMoney(existing.amount + parseFloat(movement.amount || "0"));
    if (String(movement.created_at || "") > String(existing.createdAt || "")) {
      existing.createdAt = movement.created_at;
    }
  }

  return [...activityRows, ...groupedWithdrawals.values()];
}

function fixedSavingsLedgerRows(rows: any[]) {
  const groupedWithdrawals = new Map<string, any>();
  const ledgerRows: any[] = [];

  for (const movement of rows) {
    if (movement.type !== "Withdrawal" || !movement.withdrawal_batch_id) {
      ledgerRows.push(movement);
      continue;
    }

    const key = String(movement.withdrawal_batch_id);
    const existing = groupedWithdrawals.get(key);
    if (!existing) {
      groupedWithdrawals.set(key, {
        ...movement,
        id: `fixed-savings-withdrawal-${key}`,
        amount: roundMoney(parseFloat(movement.amount || "0")),
      });
      continue;
    }

    existing.amount = roundMoney(existing.amount + parseFloat(movement.amount || "0"));
    if (String(movement.created_at || "") > String(existing.created_at || "")) {
      existing.created_at = movement.created_at;
    }
  }

  return [...ledgerRows, ...groupedWithdrawals.values()].sort((a: any, b: any) => {
    const dateOrder = String(b.date).localeCompare(String(a.date));
    if (dateOrder !== 0) return dateOrder;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Financial records may be backdated but never post-dated: a future-dated
 * movement would issue units against a NAV that does not exist yet.
 */
export function assertNotFutureDate(date: string, label = "Date") {
  if (!ISO_DATE_PATTERN.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
  const today = todayIso();
  if (date > today) {
    throw new Error(`${label} cannot be in the future (today is ${today}).`);
  }
}
const DEFAULT_BROKERAGE_FEE_RATE = "2.0";
const DEFAULT_FIXED_SAVINGS_RATE = "4.0";
const RESETTABLE_FINANCIAL_TABLES = BACKUP_TABLES;
const PORTAL_ACCESS_WINDOW_MINUTES = 15;
const PORTAL_ACCESS_MAX_REQUESTS = 120;
const PORTAL_ACCESS_WINDOW_INTERVAL = `${PORTAL_ACCESS_WINDOW_MINUTES} minutes`;

function assertResettableTableName(tableName: string) {
  assertBackupTableName(tableName);
}

async function existingResettableTables() {
  const existing: string[] = [];
  for (const tableName of RESETTABLE_FINANCIAL_TABLES) {
    assertResettableTableName(tableName);
    const result = await sql`SELECT to_regclass(${tableName}) as table_name`;
    if (result.rows[0]?.table_name) existing.push(tableName);
  }
  return existing;
}

async function resetFundConfigDefaults() {
  await sql`
    CREATE TABLE IF NOT EXISTS fund_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    INSERT INTO fund_config (key, value, updated_at)
    VALUES ('brokerage_fee_pct', ${DEFAULT_BROKERAGE_FEE_RATE}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  await ensureFixedSavingsRateTables();
}

function ledgerAmount(row: FixedSavingsLedgerRow) {
  return parseFloat(String(row.amount || "0"));
}

function ledgerRate(row: FixedSavingsLedgerRow, fallback = 0) {
  const rawRate = row.annual_rate_percent ?? row.interest_rate ?? fallback;
  return parseFloat(String(rawRate || "0"));
}

let auditColumnsPromise: Promise<void> | null = null;
let investorPortalAccessColumnsPromise: Promise<void> | null = null;
let fixedSavingsRateTablesPromise: Promise<void> | null = null;

function runOnce(current: Promise<void> | null, setCurrent: (promise: Promise<void> | null) => void, work: () => Promise<void>) {
  if (current) return current;
  const promise = work().catch((error) => {
    setCurrent(null);
    throw error;
  });
  setCurrent(promise);
  return promise;
}

async function ensureAuditColumnsUncached() {
  await ensureFixedSavingsRateTables();
  await sql`
    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS reason TEXT`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS withdrawal_batch_id UUID`;
  await sql`ALTER TABLE fixed_savings_ledger DROP CONSTRAINT IF EXISTS fixed_savings_ledger_type_check`;
  await sql`ALTER TABLE fixed_savings_ledger ADD CONSTRAINT fixed_savings_ledger_type_check CHECK (type IN ('Deposit', 'Withdrawal', 'Bonus', 'InterestWithdrawal'))`;
  await sql`ALTER TABLE performance_fees ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE performance_fees ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  // Cash the operator has taken out of the brokerage pot. Created here as well
  // as in ensureFreshFundSchema: a table defined in only one of the two is how
  // settled_gross_amount broke every fresh install.
  await sql`
    CREATE TABLE IF NOT EXISTS brokerage_withdrawals (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      date DATE NOT NULL,
      amount NUMERIC(15, 4) NOT NULL,
      type TEXT NOT NULL DEFAULT 'CASH',
      notes TEXT,
      audit_status TEXT NOT NULL DEFAULT 'active',
      reversal_of_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  // Rows written before offsets existed are all real cash, so the default is
  // correct for them and no backfill is needed.
  await sql`ALTER TABLE brokerage_withdrawals ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'CASH'`;
  await sql`ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'equity'`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS total_value NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS equity_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS fixed_savings_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS brokerage_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS equity_unrealized_profit NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS brokerage_profit_loss NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  // Which rows carry a value the admin typed into the Override column. That is
  // what lockNavWeek turns into real value marks, and it cannot be inferred from
  // valuation_source: an override and a mark already recorded on the NAV date
  // both read RECORDED.
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS is_override BOOLEAN NOT NULL DEFAULT FALSE`;
  // fund_cash is the whole bank balance; equity_fund_cash is the slice of it
  // that priced the units, so gross_assets can be re-derived from stored
  // columns instead of being an opaque number.
  await sql`ALTER TABLE nav_weeks ADD COLUMN IF NOT EXISTS equity_fund_cash NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS audit_events_action_created_at_idx ON audit_events (action, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS audit_events_reversal_original_idx ON audit_events ((details->>'originalAuditEventId')) WHERE action LIKE '%.revert'`;
  await sql`CREATE INDEX IF NOT EXISTS platform_transactions_latest_active_idx ON platform_transactions (platform_id, date DESC, created_at DESC) WHERE audit_status = 'active'`;
  await sql`CREATE INDEX IF NOT EXISTS cash_movements_latest_active_idx ON cash_movements (investor_id, date DESC, created_at DESC) WHERE audit_status = 'active'`;
  await sql`CREATE INDEX IF NOT EXISTS investor_unit_ledger_latest_active_idx ON investor_unit_ledger (investor_id, date DESC, created_at DESC) WHERE audit_status = 'active'`;
  await sql`CREATE INDEX IF NOT EXISTS fixed_savings_account_latest_active_idx ON fixed_savings_ledger (account_id, date DESC, created_at DESC) WHERE audit_status = 'active' AND account_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS fixed_savings_legacy_latest_active_idx ON fixed_savings_ledger (investor_id, date DESC, created_at DESC) WHERE audit_status = 'active' AND account_id IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS fixed_savings_withdrawal_batch_idx ON fixed_savings_ledger (withdrawal_batch_id, date DESC, created_at DESC) WHERE withdrawal_batch_id IS NOT NULL`;
}

export async function ensureAuditColumns() {
  return runOnce(auditColumnsPromise, (promise) => {
    auditColumnsPromise = promise;
  }, ensureAuditColumnsUncached);
}

async function ensureFixedSavingsRateTablesUncached() {
  await sql`
    CREATE TABLE IF NOT EXISTS fixed_savings_base_rates (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      effective_date DATE NOT NULL UNIQUE,
      annual_rate_percent NUMERIC(8, 4) NOT NULL CHECK (annual_rate_percent >= 0 AND annual_rate_percent <= 100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS fixed_savings_promotions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      annual_rate_percent NUMERIC(8, 4) NOT NULL CHECK (annual_rate_percent >= 0 AND annual_rate_percent <= 100),
      balance_cap NUMERIC(15, 4),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CHECK (end_date >= start_date),
      CHECK (balance_cap IS NULL OR balance_cap > 0)
    );
  `;
  await sql`
    INSERT INTO fixed_savings_base_rates (effective_date, annual_rate_percent)
    VALUES ('1970-01-01', ${DEFAULT_FIXED_SAVINGS_RATE})
    ON CONFLICT (effective_date) DO NOTHING
  `;
  await sql`CREATE INDEX IF NOT EXISTS fixed_savings_base_rates_effective_date_idx ON fixed_savings_base_rates (effective_date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS fixed_savings_promotions_active_period_idx ON fixed_savings_promotions (start_date, end_date) WHERE status = 'active'`;
}

export async function ensureFixedSavingsRateTables() {
  return runOnce(fixedSavingsRateTablesPromise, (promise) => {
    fixedSavingsRateTablesPromise = promise;
  }, ensureFixedSavingsRateTablesUncached);
}

export async function getFixedSavingsRateInputs(): Promise<FixedSavingsRateInput> {
  await ensureFixedSavingsRateTables();
  const [baseRates, promotions] = await Promise.all([
    sql`
      SELECT id, TO_CHAR(effective_date, 'YYYY-MM-DD') as effective_date, annual_rate_percent, created_at
      FROM fixed_savings_base_rates
      ORDER BY effective_date ASC, created_at ASC
    `,
    sql`
      SELECT id, name, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
        annual_rate_percent, balance_cap, status, notes, created_at
      FROM fixed_savings_promotions
      ORDER BY start_date DESC, created_at DESC
    `,
  ]);
  return {
    baseRates: baseRates.rows as FixedSavingsBaseRateRow[],
    promotions: promotions.rows as FixedSavingsPromotionRow[],
  };
}

export async function getFixedSavingsRateSettings() {
  const rateInput = await getFixedSavingsRateInputs();
  const today = todayIso();
  return {
    ...rateInput,
    currentBaseRate: baseRateForDate(today, normalizeFixedSavingsRates(rateInput).baseRates, Number(DEFAULT_FIXED_SAVINGS_RATE)),
  };
}

function calculateEquityCapitalPosition(rows: EquityUnitLedgerRow[]) {
  let units = 0;
  let investedCapital = 0;

  for (const row of rows) {
    const movementUnits = roundUnits(parseFloat(String(row.units || "0")));
    const grossAmount = roundMoney(parseFloat(String(row.gross_amount || "0")));

    if (row.type === "UnitIssue") {
      units = roundUnits(units + movementUnits);
      if (!row.is_bonus) {
        investedCapital = roundMoney(investedCapital + grossAmount);
      }
    } else if (row.type === "UnitRedemption") {
      // Silently skipping a redemption with no units behind it would report a
      // corrupt ledger as a valid zero position.
      if (units <= 0) {
        throw new Error(`Unit redemption on ${row.date} has no units to redeem against.`);
      }
      const unitsRedeemed = Math.min(movementUnits, units);
      const redeemedBasis = row.is_bonus ? 0 : roundMoney((investedCapital / units) * unitsRedeemed);
      units = roundUnits(units - unitsRedeemed);
      investedCapital = roundMoney(Math.max(0, investedCapital - redeemedBasis));
    }
  }

  return {
    units,
    investedCapital,
  };
}

function calculateEquityPerformance(marketValue: number, investedCapital: number) {
  const equityPnlAmount = roundMoney(marketValue - investedCapital);
  return {
    equityPnlAmount,
    equityReturnPercent: investedCapital > 0 ? roundMoney((equityPnlAmount / investedCapital) * 100) : null,
  };
}

async function getBrokerageFeeRateValue() {
  const res = await sql`SELECT value FROM fund_config WHERE key = 'brokerage_fee_pct'`;
  return parseFloat(res.rows[0]?.value ?? DEFAULT_BROKERAGE_FEE_RATE);
}

function addDaysIso(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeFixedSavingsRates(rateInput?: FixedSavingsRateInput) {
  const baseRates = (rateInput?.baseRates.length ? rateInput.baseRates : [{ effective_date: "1970-01-01", annual_rate_percent: DEFAULT_FIXED_SAVINGS_RATE }])
    .map((rate) => ({
      effectiveDate: String(rate.effective_date),
      annualRatePercent: Number(rate.annual_rate_percent || 0),
    }))
    .filter((rate) => Number.isFinite(rate.annualRatePercent) && rate.annualRatePercent >= 0)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const promotions = (rateInput?.promotions ?? [])
    .filter((promotion) => promotion.status === "active")
    .map((promotion) => ({
      startDate: String(promotion.start_date),
      endDate: String(promotion.end_date),
      annualRatePercent: Number(promotion.annual_rate_percent || 0),
      balanceCap: promotion.balance_cap == null ? null : Number(promotion.balance_cap),
    }))
    .filter((promotion) => Number.isFinite(promotion.annualRatePercent) && promotion.annualRatePercent >= 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { baseRates, promotions };
}

function baseRateForDate(date: string, baseRates: ReturnType<typeof normalizeFixedSavingsRates>["baseRates"], fallbackRate: number) {
  let rate = Number.isFinite(fallbackRate) && fallbackRate > 0 ? fallbackRate : Number(DEFAULT_FIXED_SAVINGS_RATE);
  for (const baseRate of baseRates) {
    if (baseRate.effectiveDate <= date) rate = baseRate.annualRatePercent;
    else break;
  }
  return rate;
}

function promotionForDate(date: string, promotions: ReturnType<typeof normalizeFixedSavingsRates>["promotions"]) {
  return promotions.find((promotion) => promotion.startDate <= date && promotion.endDate >= date) ?? null;
}

function accruePooledNominalInterest({
  balance,
  startDate,
  endDate,
  fallbackRate,
  rateInput,
}: {
  balance: number;
  startDate: string;
  endDate: string;
  fallbackRate: number;
  rateInput?: FixedSavingsRateInput;
}) {
  if (balance <= 0 || startDate >= endDate) return { balance, interest: 0 };
  const rates = normalizeFixedSavingsRates(rateInput);
  let currentDate = startDate;
  let currentBalance = balance;

  // Walk rate segments rather than individual days. Within a segment the rate
  // is constant, so compounding closes into a single power - which matters
  // because this runs per investor on every dashboard, statement and portal
  // render, and the day loop grew without bound as the book aged. A capped
  // promotion is genuinely path-dependent (the promoted slice changes as the
  // balance grows past the cap), so those segments still step day by day.
  while (currentDate < endDate) {
    const baseRate = baseRateForDate(currentDate, rates.baseRates, fallbackRate);
    const promotion = promotionForDate(currentDate, rates.promotions);
    const segmentEnd = nextFixedSavingsRateBoundary(currentDate, endDate, rates, promotion);
    const days = daysBetween(currentDate, segmentEnd);

    if (days > 0) {
      const baseDailyRate = baseRate / 100 / 365;
      if (!promotion) {
        currentBalance *= (1 + baseDailyRate) ** days;
      } else if (promotion.balanceCap == null) {
        currentBalance *= (1 + promotion.annualRatePercent / 100 / 365) ** days;
      } else {
        const promotedDailyRate = promotion.annualRatePercent / 100 / 365;
        for (let day = 0; day < days; day += 1) {
          const promotedBalance = Math.min(currentBalance, promotion.balanceCap);
          const standardBalance = Math.max(0, currentBalance - promotedBalance);
          currentBalance += (promotedBalance * promotedDailyRate) + (standardBalance * baseDailyRate);
        }
      }
    }
    currentDate = segmentEnd;
  }

  return {
    balance: roundMoney(currentBalance),
    interest: roundMoney(currentBalance - balance),
  };
}

/**
 * The next date at or before `endDate` on which the applicable rate changes:
 * a base-rate effective date, a promotion starting, or the active promotion
 * ending.
 */
function nextFixedSavingsRateBoundary(
  currentDate: string,
  endDate: string,
  rates: ReturnType<typeof normalizeFixedSavingsRates>,
  promotion: ReturnType<typeof promotionForDate>,
) {
  let boundary = endDate;
  const consider = (candidate: string) => {
    if (candidate > currentDate && candidate < boundary) boundary = candidate;
  };

  for (const rate of rates.baseRates) consider(rate.effectiveDate);
  for (const promo of rates.promotions) {
    consider(promo.startDate);
    consider(addDaysIso(promo.endDate, 1));
  }
  if (promotion) consider(addDaysIso(promotion.endDate, 1));
  return boundary;
}

export function calculateFixedSavingsLiability(rows: FixedSavingsLedgerRow[], endDate = todayIso(), rateInput?: FixedSavingsRateInput) {
  const orderedRows = [...rows].filter((row) => row.audit_status !== "reverted").sort((a, b) => {
    const dateOrder = String(a.date).localeCompare(String(b.date));
    if (dateOrder !== 0) return dateOrder;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  const withdrawalBatches = new Map<string, FixedSavingsLedgerRow & { amount: number }>();
  const transactions: FixedSavingsLedgerRow[] = [];

  for (const row of orderedRows) {
    if (row.type === "Withdrawal" && row.withdrawal_batch_id) {
      const existing = withdrawalBatches.get(row.withdrawal_batch_id);
      if (existing) {
        existing.amount = roundMoney(existing.amount + ledgerAmount(row));
      } else {
        withdrawalBatches.set(row.withdrawal_batch_id, { ...row, amount: ledgerAmount(row), account_id: null });
      }
      continue;
    }
    transactions.push(row);
  }

  transactions.push(...withdrawalBatches.values());
  transactions.sort((a, b) => {
    const dateOrder = String(a.date).localeCompare(String(b.date));
    if (dateOrder !== 0) return dateOrder;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  type FixedSavingsInvestorState = {
    principal: number;
    accruedInterest: number;
    totalAccruedInterest: number;
    bonusPayable: number;
    balance: number;
    accruedThrough: string;
    fallbackRate: number;
  };
  const investorStates = new Map<string, FixedSavingsInvestorState>();

  function stateFor(row: FixedSavingsLedgerRow) {
    const investorId = row.investor_id || "fund";
    const existing = investorStates.get(investorId);
    if (existing) return existing;
    const state = {
      principal: 0,
      accruedInterest: 0,
      totalAccruedInterest: 0,
      bonusPayable: 0,
      balance: 0,
      accruedThrough: row.date,
      fallbackRate: ledgerRate(row),
    };
    investorStates.set(investorId, state);
    return state;
  }

  function accrueState(state: FixedSavingsInvestorState, date: string) {
    const result = accruePooledNominalInterest({
      balance: state.balance,
      startDate: state.accruedThrough,
      endDate: date,
      fallbackRate: state.fallbackRate,
      rateInput,
    });
    state.balance = result.balance;
    state.accruedInterest = roundMoney(state.accruedInterest + result.interest);
    state.totalAccruedInterest = roundMoney(state.totalAccruedInterest + result.interest);
    state.accruedThrough = date;
  }

  function reduceState(state: FixedSavingsInvestorState, amount: number) {
    let remaining = roundMoney(amount);
    const interestReduction = Math.min(remaining, state.accruedInterest);
    state.accruedInterest = roundMoney(state.accruedInterest - interestReduction);
    remaining = roundMoney(remaining - interestReduction);

    const principalReduction = Math.min(remaining, state.principal);
    state.principal = roundMoney(state.principal - principalReduction);
    remaining = roundMoney(remaining - principalReduction);

    const bonusReduction = Math.min(remaining, state.bonusPayable);
    state.bonusPayable = roundMoney(state.bonusPayable - bonusReduction);
    state.balance = roundMoney(Math.max(0, state.balance - amount));
  }

  for (const row of transactions) {
    const state = stateFor(row);
    accrueState(state, row.date);
    const amount = ledgerAmount(row);

    if (row.type === "Deposit") {
      state.principal = roundMoney(state.principal + amount);
      state.balance = roundMoney(state.balance + amount);
      const rowRate = ledgerRate(row);
      if (rowRate > 0) state.fallbackRate = rowRate;
    } else if (row.type === "Withdrawal" || row.type === "InterestWithdrawal") {
      reduceState(state, amount);
    } else if (row.type === "Bonus") {
      state.bonusPayable = roundMoney(state.bonusPayable + amount);
      state.balance = roundMoney(state.balance + amount);
    }
  }

  for (const state of investorStates.values()) {
    accrueState(state, endDate);
  }

  let principal = 0;
  let accruedInterest = 0;
  let totalAccruedInterest = 0;
  let bonusPayable = 0;
  const byInvestor = new Map<string, { principal: number; accruedInterest: number; totalAccruedInterest: number; bonusPayable: number; payableInterest: number; totalLiability: number }>();

  for (const [investorId, state] of investorStates.entries()) {
    principal = roundMoney(principal + state.principal);
    accruedInterest = roundMoney(accruedInterest + state.accruedInterest);
    totalAccruedInterest = roundMoney(totalAccruedInterest + state.totalAccruedInterest);
    bonusPayable = roundMoney(bonusPayable + state.bonusPayable);
    byInvestor.set(investorId, {
      principal: roundMoney(state.principal),
      accruedInterest: roundMoney(state.accruedInterest),
      totalAccruedInterest: roundMoney(state.totalAccruedInterest),
      bonusPayable: roundMoney(state.bonusPayable),
      payableInterest: roundMoney(state.accruedInterest + state.bonusPayable),
      totalLiability: roundMoney(state.balance),
    });
  }

  return {
    principal: roundMoney(principal),
    accruedInterest: roundMoney(accruedInterest),
    totalAccruedInterest: roundMoney(totalAccruedInterest),
    bonusPayable: roundMoney(bonusPayable),
    payableInterest: roundMoney(accruedInterest + bonusPayable),
    totalLiability: roundMoney([...byInvestor.values()].reduce((sum, item) => sum + item.totalLiability, 0)),
    byInvestor,
  };
}

export async function initializeFreshFundDatabase() {
  await ensureFreshFundSchema();
  await resetFundConfigDefaults();
  await writeAuditEvent("development.initialize_schema", "database", null, {
    brokerageFeePercent: DEFAULT_BROKERAGE_FEE_RATE,
  });
}

async function ensureInvestorPortalAccessColumnsUncached() {
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS portal_access_id TEXT`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS portal_access_rotated_at TIMESTAMPTZ`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS investors_portal_access_id_key
    ON investors (portal_access_id)
    WHERE portal_access_id IS NOT NULL
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS portal_access_events (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID REFERENCES investors(id) ON DELETE SET NULL,
      portal_access_hash TEXT NOT NULL,
      client_key TEXT NOT NULL,
      user_agent TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'not_found', 'rate_limited', 'rotated')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS portal_access_events_client_created_idx ON portal_access_events (client_key, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS portal_access_events_portal_created_idx ON portal_access_events (portal_access_hash, created_at DESC)`;
}

async function ensureInvestorPortalAccessColumns() {
  return runOnce(investorPortalAccessColumnsPromise, (promise) => {
    investorPortalAccessColumnsPromise = promise;
  }, ensureInvestorPortalAccessColumnsUncached);
}

function hashPortalAccessId(portalAccessId: string) {
  return createHash("sha256").update(portalAccessId).digest("base64url");
}

async function assertPortalAccessAllowed(portalAccessHash: string, meta?: PortalAccessMeta) {
  if (!meta?.clientKey) return;
  const result = await sql`
    SELECT COUNT(*)::int as requests
    FROM portal_access_events
    WHERE client_key = ${meta.clientKey}
      AND created_at > NOW() - ${PORTAL_ACCESS_WINDOW_INTERVAL}::interval
  `;
  if (Number(result.rows[0]?.requests || 0) >= PORTAL_ACCESS_MAX_REQUESTS) {
    await writePortalAccessEvent({
      investorId: null,
      portalAccessHash,
      meta,
      outcome: "rate_limited",
    });
    throw new Error("Too many portal access attempts. Try again later.");
  }
}

async function writePortalAccessEvent({
  investorId,
  portalAccessHash,
  meta,
  outcome,
}: {
  investorId: string | null;
  portalAccessHash: string;
  meta?: PortalAccessMeta;
  outcome: "success" | "not_found" | "rate_limited" | "rotated";
}) {
  if (!meta?.clientKey) return;
  await sql`
    INSERT INTO portal_access_events (investor_id, portal_access_hash, client_key, user_agent, outcome)
    VALUES (${investorId}, ${portalAccessHash}, ${meta.clientKey}, ${meta.userAgent || null}, ${outcome})
  `;
}

export async function ensureFreshFundSchema() {
  await ensureFixedSavingsRateTables();
  await sql`
    CREATE TABLE IF NOT EXISTS investors (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      portal_access_id TEXT UNIQUE,
      portal_access_rotated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await ensureInvestorPortalAccessColumnsUncached();
  await sql`
    CREATE TABLE IF NOT EXISTS nav_weeks (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      week_ending DATE NOT NULL UNIQUE,
      settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
      gross_assets NUMERIC(15, 4) NOT NULL,
      fund_cash NUMERIC(15, 4) NOT NULL DEFAULT 0,
      equity_fund_cash NUMERIC(15, 4) NOT NULL DEFAULT 0,
      liabilities NUMERIC(15, 4) NOT NULL DEFAULT 0,
      adjustments NUMERIC(15, 4) NOT NULL DEFAULT 0,
      net_asset_value NUMERIC(15, 4) NOT NULL,
      total_units NUMERIC(20, 6) NOT NULL DEFAULT 0,
      nav_per_unit NUMERIC(20, 6) NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
      locked_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE nav_weeks ALTER COLUMN settlement_date SET DEFAULT CURRENT_DATE`;
  await sql`ALTER TABLE nav_weeks ADD COLUMN IF NOT EXISTS fund_cash NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_weeks ADD COLUMN IF NOT EXISTS equity_fund_cash NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`
    CREATE TABLE IF NOT EXISTS investor_unit_ledger (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      nav_week_id UUID REFERENCES nav_weeks(id) ON DELETE SET NULL,
      date DATE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('UnitIssue', 'UnitRedemption')),
      units NUMERIC(20, 6) NOT NULL,
      nav_per_unit NUMERIC(20, 6) NOT NULL,
      gross_amount NUMERIC(15, 4) NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS investor_id UUID REFERENCES investors(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS nav_week_id UUID REFERENCES nav_weeks(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS date DATE`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS type TEXT`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS units NUMERIC(20, 6) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS nav_per_unit NUMERIC(20, 6) NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS notes TEXT`;
  await sql`ALTER TABLE investor_unit_ledger ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
  await sql`
    CREATE TABLE IF NOT EXISTS cash_movements (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      nav_week_id UUID REFERENCES nav_weeks(id) ON DELETE SET NULL,
      unit_ledger_id UUID REFERENCES investor_unit_ledger(id) ON DELETE SET NULL,
      date DATE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('Deposit', 'Withdrawal')),
      amount NUMERIC(15, 4) NOT NULL,
      status TEXT NOT NULL DEFAULT 'settled' CHECK (status IN ('pending', 'settled', 'rejected')),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS investor_id UUID REFERENCES investors(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS nav_week_id UUID REFERENCES nav_weeks(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS unit_ledger_id UUID REFERENCES investor_unit_ledger(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS date DATE`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS type TEXT`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS amount NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'settled'`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS notes TEXT`;
  await sql`ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
  await sql`
    CREATE TABLE IF NOT EXISTS fixed_savings_accounts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      opened_at DATE NOT NULL DEFAULT CURRENT_DATE,
      annual_rate_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS fixed_savings_ledger (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      account_id UUID REFERENCES fixed_savings_accounts(id) ON DELETE CASCADE,
      investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('Deposit', 'Withdrawal', 'Bonus', 'InterestWithdrawal')),
      amount NUMERIC(15, 4) NOT NULL,
      annual_rate_percent NUMERIC(8, 4),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES fixed_savings_accounts(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS annual_rate_percent NUMERIC(8, 4)`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(8, 4) DEFAULT NULL`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS withdrawal_batch_id UUID`;
  await sql`ALTER TABLE fixed_savings_ledger DROP CONSTRAINT IF EXISTS fixed_savings_ledger_type_check`;
  await sql`ALTER TABLE fixed_savings_ledger ADD CONSTRAINT fixed_savings_ledger_type_check CHECK (type IN ('Deposit', 'Withdrawal', 'Bonus', 'InterestWithdrawal'))`;
  await sql`
    CREATE TABLE IF NOT EXISTS performance_fees (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID REFERENCES investors(id) ON DELETE SET NULL,
      nav_week_id UUID REFERENCES nav_weeks(id) ON DELETE SET NULL,
      crystallized_gain NUMERIC(15, 4) NOT NULL,
      fee_rate_percent NUMERIC(8, 4) NOT NULL,
      fee_amount NUMERIC(15, 4) NOT NULL,
      date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS capital_ledger (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      type TEXT NOT NULL,
      amount NUMERIC(15, 4) NOT NULL,
      notes TEXT,
      receipt_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS investor_profit_claims (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
      locked_amount NUMERIC(15, 4) NOT NULL,
      settled_amount NUMERIC(15, 4) NOT NULL DEFAULT 0,
      settled_gross_amount NUMERIC(15, 4) NOT NULL DEFAULT 0,
      brokerage_fee NUMERIC(15, 4) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      claim_date DATE NOT NULL,
      settled_date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE investor_profit_claims ADD COLUMN IF NOT EXISTS brokerage_fee NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  // Gross profit crystallized out of the position by settlement, as opposed to
  // settled_amount which is the net cash paid.
  await sql`ALTER TABLE investor_profit_claims ADD COLUMN IF NOT EXISTS settled_gross_amount NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`
    CREATE TABLE IF NOT EXISTS platforms (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      base_currency TEXT NOT NULL DEFAULT 'MYR',
      default_currency TEXT NOT NULL DEFAULT 'MYR',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE platforms ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'MYR'`;
  await sql`ALTER TABLE platforms ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'MYR'`;
  // The date a broker account was shut. Null means live. Without it a dead
  // account has no recorded mark, so resolvePlatformValue carries it at *cost* -
  // gross assets keep value that no longer exists and NAV per unit is overstated
  // until the account happens to be both stale and material enough to block a
  // lock. It also tells the brokerage pot that the loss is realised rather than
  // a mark that might still come back.
  await sql`ALTER TABLE platforms ADD COLUMN IF NOT EXISTS closed_on DATE`;
  // Tracking modes were removed: every platform is valued the same way, from
  // recorded value marks. Drop the column so no stale mode can be read back.
  await sql`ALTER TABLE platforms DROP CONSTRAINT IF EXISTS platforms_tracking_mode_check`;
  await sql`ALTER TABLE platforms DROP COLUMN IF EXISTS tracking_mode`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_valuations (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      as_of_date DATE NOT NULL,
      total_value NUMERIC(15, 4) NOT NULL,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      notes TEXT,
      audit_status TEXT NOT NULL DEFAULT 'active',
      reversal_of_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(platform_id, as_of_date)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS platform_valuations_platform_date_idx ON platform_valuations (platform_id, as_of_date DESC)`;
  // Cash the fund holds outside any platform - money withdrawn from a broker,
  // or investor capital not deployed yet. Without this it belonged to no
  // platform and so fell out of gross assets entirely.
  await sql`
    CREATE TABLE IF NOT EXISTS fund_cash_valuations (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      as_of_date DATE NOT NULL UNIQUE,
      balance NUMERIC(15, 4) NOT NULL,
      notes TEXT,
      audit_status TEXT NOT NULL DEFAULT 'active',
      reversal_of_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS fund_cash_valuations_date_idx ON fund_cash_valuations (as_of_date DESC)`;
  // Superseded by fund_cash_valuations. It was seeded and backed up but never
  // read, which made it look like fund cash was already tracked.
  await sql`DROP TABLE IF EXISTS cash_balances`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_accounts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'BROKER_CASH',
      currency TEXT NOT NULL DEFAULT 'MYR',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(platform_id, name, currency)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_assets (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      name TEXT,
      asset_type TEXT NOT NULL DEFAULT 'SECURITY',
      currency TEXT NOT NULL DEFAULT 'MYR',
      latest_price NUMERIC(20, 8) NOT NULL DEFAULT 0,
      latest_fx_rate_to_myr NUMERIC(20, 8) NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(platform_id, symbol, currency)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS nav_week_platform_snapshots (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      nav_week_id UUID NOT NULL REFERENCES nav_weeks(id) ON DELETE CASCADE,
      platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0,
      unrealized_profit NUMERIC(15, 4) NOT NULL DEFAULT 0,
      total_value NUMERIC(15, 4) NOT NULL DEFAULT 0,
      equity_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0,
      fixed_savings_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0,
      brokerage_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0,
      equity_unrealized_profit NUMERIC(15, 4) NOT NULL DEFAULT 0,
      brokerage_profit_loss NUMERIC(15, 4) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      valuation_date DATE,
      valuation_source TEXT NOT NULL DEFAULT 'RECORDED',
      valuation_age_days INTEGER NOT NULL DEFAULT 0,
      weight_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
      is_override BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE(nav_week_id, platform_id)
    );
  `;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS valuation_date DATE`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS valuation_source TEXT NOT NULL DEFAULT 'RECORDED'`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS valuation_age_days INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS weight_percent NUMERIC(10, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS total_value NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS equity_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS fixed_savings_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS brokerage_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS equity_unrealized_profit NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS brokerage_profit_loss NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  // Which rows carry a value the admin typed into the Override column. That is
  // what lockNavWeek turns into real value marks, and it cannot be inferred from
  // valuation_source: an override and a mark already recorded on the NAV date
  // both read RECORDED.
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS is_override BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_transactions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      account_id UUID REFERENCES platform_accounts(id) ON DELETE SET NULL,
      asset_id UUID REFERENCES platform_assets(id) ON DELETE SET NULL,
      date DATE NOT NULL,
      type TEXT NOT NULL,
      amount NUMERIC(15, 4) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'MYR',
      base_currency TEXT NOT NULL DEFAULT 'MYR',
      base_amount NUMERIC(20, 4) NOT NULL DEFAULT 0,
      fx_rate_to_base NUMERIC(20, 8) NOT NULL DEFAULT 1,
      from_currency TEXT,
      to_currency TEXT,
      from_amount NUMERIC(20, 8),
      to_amount NUMERIC(20, 8),
      quantity NUMERIC(24, 8),
      price_per_unit NUMERIC(20, 8),
      gross_amount NUMERIC(20, 4),
      fee_amount NUMERIC(20, 4) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(20, 4) NOT NULL DEFAULT 0,
      net_amount NUMERIC(20, 4),
      realized_profit NUMERIC(15, 4) DEFAULT NULL,
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'SETTLED',
      settlement_date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'equity'`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS realized_profit NUMERIC(15, 4) DEFAULT NULL`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES platform_accounts(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES platform_assets(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MYR'`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'MYR'`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS base_amount NUMERIC(20, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS fx_rate_to_base NUMERIC(20, 8) NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS from_currency TEXT`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS to_currency TEXT`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS from_amount NUMERIC(20, 8)`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS to_amount NUMERIC(20, 8)`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS quantity NUMERIC(24, 8)`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS price_per_unit NUMERIC(20, 8)`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(20, 4)`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(20, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(20, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS net_amount NUMERIC(20, 4)`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS reference TEXT`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SETTLED'`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS settlement_date DATE`;
  await sql`UPDATE platform_transactions SET base_amount = amount WHERE base_amount = 0 AND amount <> 0`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_transaction_allocations (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      transaction_id UUID NOT NULL REFERENCES platform_transactions(id) ON DELETE CASCADE,
      funding_source TEXT NOT NULL,
      ratio_percent NUMERIC(10, 4) NOT NULL,
      base_amount NUMERIC(20, 4) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(transaction_id, funding_source)
    )
  `;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS allocation_method TEXT NOT NULL DEFAULT 'legacy'`;
  await sql`
    CREATE TABLE IF NOT EXISTS trading_ledger (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      date DATE NOT NULL,
      platform TEXT NOT NULL,
      ticker TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT NOT NULL,
      price NUMERIC(15, 4) NOT NULL,
      quantity NUMERIC(15, 4) NOT NULL,
      amount_rm NUMERIC(15, 2) NOT NULL,
      profit_loss NUMERIC(15, 2),
      date_closed DATE,
      receipt_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS fund_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bonus_payments (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
      ledger_type TEXT NOT NULL,
      source_id UUID,
      amount NUMERIC(15, 4) NOT NULL,
      date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS source_id UUID`;
  await sql`
    CREATE TABLE IF NOT EXISTS brokerage_withdrawals (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      date DATE NOT NULL,
      amount NUMERIC(15, 4) NOT NULL,
      type TEXT NOT NULL DEFAULT 'CASH',
      notes TEXT,
      audit_status TEXT NOT NULL DEFAULT 'active',
      reversal_of_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  // Rows written before offsets existed are all real cash, so the default is
  // correct for them and no backfill is needed.
  await sql`ALTER TABLE brokerage_withdrawals ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'CASH'`;
  await sql`CREATE INDEX IF NOT EXISTS brokerage_withdrawals_date_idx ON brokerage_withdrawals (date DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await ensureAuditColumns();
}

/**
 * A tagged-template executor. Satisfied both by the pooled `sql` and by a
 * transaction-bound client, so a function can be written once and run either
 * standalone or as part of a larger atomic operation.
 */
type SqlPrimitive = string | number | boolean | undefined | null;
export type SqlExecutor = <O extends QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: SqlPrimitive[]
) => Promise<QueryResult<O>>;

/**
 * Run several writes as one unit.
 *
 * Financial operations touch three or four tables each - a fee, a unit ledger
 * row, a cash movement, an audit event - and previously issued them as
 * independent statements. A failure partway through left units issued with no
 * matching cash movement, or a platform transaction with no funding
 * allocations, both of which silently corrupt every balance derived from them.
 */
export async function withTransaction<T>(work: (db: SqlExecutor) => Promise<T>): Promise<T> {
  const client = createClient();
  await client.connect();
  const db = client.sql.bind(client) as SqlExecutor;
  try {
    await client.query("BEGIN");
    const result = await work(db);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original failure is more useful than a rollback failure.
    }
    throw error;
  } finally {
    try {
      await client.end();
    } catch {
      // Nothing recoverable once the outcome is known.
    }
  }
}

export async function writeAuditEvent(
  action: string,
  entityType: string,
  entityId: string | null,
  details = {},
  db: SqlExecutor = sql,
) {
  await db`
    INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details)
    VALUES ('system', ${action}, ${entityType}, ${entityId}, ${JSON.stringify(details)}::jsonb)
  `;
}

export async function getTotalUnits() {
  const res = await sql`
    SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total
    FROM investor_unit_ledger
    WHERE audit_status = 'active'
  `;
  return roundUnits(parseFloat(res.rows[0]?.total || "0"));
}

export async function getInvestorUnits(investorId: string) {
  const res = await sql`
    SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total
    FROM investor_unit_ledger
    WHERE investor_id = ${investorId}
      AND audit_status = 'active'
  `;
  return roundUnits(parseFloat(res.rows[0]?.total || "0"));
}

export async function getLatestLockedNavWeek() {
  const res = await sql`
    SELECT id,
      TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending,
      TO_CHAR(settlement_date, 'YYYY-MM-DD') as settlement_date,
      gross_assets, fund_cash, equity_fund_cash, liabilities, adjustments, net_asset_value,
      total_units, nav_per_unit, status, locked_at, notes, created_at
    FROM nav_weeks
    WHERE status = 'locked'
    ORDER BY nav_weeks.week_ending DESC
    LIMIT 1
  `;
  return res.rows[0] ?? null;
}

export async function getNavWeeks() {
  await requireAdmin();
  const res = await sql`
    SELECT id,
      TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending,
      TO_CHAR(settlement_date, 'YYYY-MM-DD') as settlement_date,
      gross_assets, fund_cash, equity_fund_cash, liabilities, adjustments, net_asset_value,
      total_units, nav_per_unit, status, locked_at, notes, created_at
    FROM nav_weeks
    ORDER BY nav_weeks.week_ending DESC
  `;
  return res.rows;
}

async function getPlatformValuationsAsOf(asOfDate: string) {
  const res = await sql`
    SELECT platform_id, TO_CHAR(as_of_date, 'YYYY-MM-DD') as as_of_date, total_value
    FROM platform_valuations
    WHERE audit_status = 'active' AND as_of_date <= ${asOfDate}
    ORDER BY platform_id, as_of_date DESC
  `;
  const byPlatform = new Map<string, { asOfDate: string; totalValue: number }[]>();
  for (const row of res.rows) {
    const list = byPlatform.get(row.platform_id) ?? [];
    list.push({ asOfDate: row.as_of_date, totalValue: parseFloat(row.total_value || "0") });
    byPlatform.set(row.platform_id, list);
  }
  return byPlatform;
}

/**
 * What the newest locked NAV on or before a date priced each platform at.
 *
 * The NAV review screen accepts a value for a platform that has no mark of its
 * own, and that value only ever reached the NAV's own snapshot. Without this
 * the next NAV cannot see it and falls back to cost.
 */
async function getLastNavSnapshotsAsOf(asOfDate: string) {
  const res = await sql`
    SELECT platform_id, week_ending, total_value
    FROM (
      SELECT nwps.platform_id,
             TO_CHAR(nw.week_ending, 'YYYY-MM-DD') as week_ending,
             nwps.total_value,
             ROW_NUMBER() OVER (PARTITION BY nwps.platform_id ORDER BY nw.week_ending DESC) as rn
      FROM nav_week_platform_snapshots nwps
      JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
      WHERE nw.status = 'locked' AND nw.week_ending <= ${asOfDate}
    ) ranked
    WHERE rn = 1
  `;
  const byPlatform = new Map<string, { weekEnding: string; totalValue: number }>();
  for (const row of res.rows) {
    byPlatform.set(row.platform_id, {
      weekEnding: row.week_ending,
      totalValue: parseFloat(row.total_value || "0"),
    });
  }
  return byPlatform;
}

/**
 * Every platform valued for a NAV date, with staleness metadata. This is what
 * the NAV review screen renders and what createNavWeek persists.
 */
export async function buildNavPlatformPreview(
  asOfDate: string,
  overrides: Map<string, { totalValue?: number; unrealizedProfit?: number }> = new Map(),
): Promise<NavPlatformPreview[]> {
  const [positions, valuations, fundCash, navSnapshots] = await Promise.all([
    getPlatformFundingPositions(asOfDate),
    getPlatformValuationsAsOf(asOfDate),
    getFundCashAsOf(asOfDate),
    getLastNavSnapshotsAsOf(asOfDate),
  ]);

  const resolved = positions.map((platform) => {
    const netInvested = roundMoney(platform.netInvested);
    const override = overrides.get(platform.id);
    const overrideValue =
      override === undefined
        ? undefined
        : override.totalValue !== undefined
          ? roundMoney(override.totalValue)
          : roundMoney(netInvested + (override.unrealizedProfit ?? 0));
    const valuation: ResolvedValuation =
      overrideValue !== undefined
        ? {
            totalValue: overrideValue,
            source: "RECORDED",
            valuationDate: asOfDate,
            ageDays: 0,
            isStale: false,
          }
        : resolvePlatformValue({
            netInvested,
            valuations: valuations.get(platform.id) ?? [],
            asOfDate,
            closed: platform.closed,
            lastNavSnapshot: navSnapshots.get(platform.id) ?? null,
          });

    return {
      ...valuation,
      platformId: platform.id,
      platformName: platform.name,
      netInvested,
      equityNetInvested: platform.equityNetInvested,
      fixedSavingsNetInvested: platform.fixedSavingsNetInvested,
      brokerageNetInvested: platform.brokerageNetInvested,
      equityContributed: platform.equityContributed,
      fixedSavingsContributed: platform.fixedSavingsContributed,
      brokerageContributed: platform.brokerageContributed,
      profitLoss: roundMoney(valuation.totalValue - netInvested),
      weightPercent: 0,
    };
  });

  // Weight is a share of the whole fund, so the fund's own cash belongs in the
  // denominator. Measuring against platform value alone overstated every weight
  // and tripped the stale-and-material settlement block too readily.
  const grossValue = resolved.reduce((sum, item) => sum + item.totalValue, 0)
    + Math.max(0, fundCash.balance);
  return resolved.map((item) => ({
    ...item,
    weightPercent: grossValue > 0 ? roundMoney((item.totalValue / grossValue) * 100) : 0,
  }));
}

/**
 * The fund's own cash balance for a date, carried forward from the last
 * recorded balance. Money withdrawn from a platform lands here; without it that
 * money belongs to no platform and vanishes from gross assets.
 */
export async function getFundCashAsOf(asOfDate: string): Promise<FundCashPreview> {
  const [res, expected] = await Promise.all([
    sql`
      SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') as as_of_date, balance
      FROM fund_cash_valuations
      WHERE audit_status = 'active' AND as_of_date <= ${asOfDate}
      ORDER BY as_of_date DESC
      LIMIT 1
    `,
    getExpectedFundCash(asOfDate),
  ]);
  const row = res.rows[0];

  if (!row) {
    return {
      balance: 0,
      source: "NEVER_RECORDED",
      asOfDate: null,
      ageDays: null,
      isStale: true,
      expectedBalance: expected,
    };
  }

  const balance = roundMoney(parseFloat(row.balance || "0"));
  const ageDays = daysBetween(row.as_of_date, asOfDate);
  return {
    balance,
    source: ageDays === 0 ? "RECORDED" : "CARRIED_FORWARD",
    asOfDate: row.as_of_date,
    ageDays,
    isStale: ageDays > STALE_AFTER_DAYS,
    expectedBalance: expected,
  };
}

/**
 * What the recorded ledgers imply the fund's cash should be: the last recorded
 * balance, plus investor deposits and withdrawals, minus money sent to
 * platforms, plus money taken back out of them.
 *
 * This deliberately does not chase every possible outflow - bank charges, or
 * anything moved outside the app. A gap between this and the balance the admin
 * types is exactly what needs looking at, so the NAV screen shows both rather
 * than silently trusting either one.
 */
async function getExpectedFundCash(asOfDate: string) {
  const anchorRow = await sql`
    SELECT TO_CHAR(as_of_date, 'YYYY-MM-DD') as as_of_date, balance
    FROM fund_cash_valuations
    WHERE audit_status = 'active' AND as_of_date <= ${asOfDate}
    ORDER BY as_of_date DESC
    LIMIT 1
  `;
  const anchorDate = anchorRow.rows[0]?.as_of_date ?? "1900-01-01";
  const anchorBalance = anchorRow.rows[0] ? roundMoney(parseFloat(anchorRow.rows[0].balance || "0")) : 0;

  const [platformFlows, capitalFlows, fixedSavingsFlows] = await Promise.all([
    sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END
      ), 0) as delta
      FROM platform_transactions pt
      WHERE COALESCE(pt.audit_status, 'active') = 'active'
        AND COALESCE(pt.status, 'SETTLED') = 'SETTLED'
        AND pt.date > ${anchorDate} AND pt.date <= ${asOfDate}
    `,
    sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'Deposit' THEN amount
          WHEN type = 'Withdrawal' THEN -amount
          ELSE 0
        END
      ), 0) as delta
      FROM cash_movements
      WHERE COALESCE(audit_status, 'active') = 'active'
        AND status = 'settled'
        AND date > ${anchorDate} AND date <= ${asOfDate}
    `,
    // Savers' money passes through the same bank account, so leaving it out
    // guaranteed a permanent unexplained gap once fixed savings existed.
    // 'Bonus' is a book entry against the liability and moves no cash.
    sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'Deposit' THEN amount
          WHEN type IN ('Withdrawal', 'InterestWithdrawal') THEN -amount
          ELSE 0
        END
      ), 0) as delta
      FROM fixed_savings_ledger
      WHERE COALESCE(audit_status, 'active') = 'active'
        AND date > ${anchorDate} AND date <= ${asOfDate}
    `,
  ]);

  return roundMoney(
    anchorBalance
      + parseFloat(platformFlows.rows[0]?.delta || "0")
      + parseFloat(capitalFlows.rows[0]?.delta || "0")
      + parseFloat(fixedSavingsFlows.rows[0]?.delta || "0"),
  );
}

/**
 * How the fund's bank balance divides between the three pools that have a claim
 * on it.
 *
 * Equity is the residual owner: savers hold a fixed contractual claim, the
 * brokerage pot holds what it has earned and not yet spent, and equity owns
 * whatever is left. Putting the whole bank balance into equity gross assets -
 * which is what this replaces - priced savers' money into the unit price.
 *
 *   equityCash = bankCash + nonEquityValueInPlatforms
 *                - fixedSavingsLiability - brokerageClaim
 *
 * `nonEquityValueInPlatforms` appears because the other two pools' claims are
 * partly held as platform value rather than cash; without it their deployed
 * capital would be deducted from cash it is no longer sitting in.
 *
 * The brokerage claim uses *cumulative* interest and bonuses, not outstanding
 * ones. An obligation that has been paid in cash has already left the bank, so
 * treating it as no longer owed would hand the money back to equity twice.
 */
export type FundCashAttribution = {
  bankBalance: number;
  nonEquityValueInPlatforms: number;
  fixedSavingsLiability: number;
  brokerageClaim: number;
  equity: number;
};

/** Savers' total claim on a date: principal plus interest accrued to it. */
export async function getFixedSavingsLiabilityAsOf(asOfDate?: string) {
  // Two statements rather than an interpolated WHERE clause: the tagged template
  // parameterises values, not SQL fragments, so a nested template is passed as an
  // object and rejected.
  const [rows, rateInput] = await Promise.all([
    asOfDate
      ? sql`
          SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
          FROM fixed_savings_ledger
          WHERE audit_status = 'active' AND date <= ${asOfDate}
          ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
        `
      : sql`
          SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
          FROM fixed_savings_ledger
          WHERE audit_status = 'active'
          ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
        `,
    getFixedSavingsRateInputs(),
  ]);
  return calculateFixedSavingsLiability(rows.rows as FixedSavingsLedgerRow[], asOfDate, rateInput);
}

/**
 * The brokerage pot's balance: the operator's own side of the book.
 *
 * It earns performance fees and the spread on non-equity money - savers are
 * promised a fixed rate, their capital earns whatever it earns, and the
 * difference belongs to the operator. It owes savings interest and investor
 * bonuses, and is reduced by cash already withdrawn.
 *
 * Platform P&L is taken from the latest **locked** NAV snapshot, not recomputed
 * from today's marks. That is the house convention - it is how the fund prices
 * itself and how every other locked figure on screen is derived - and this
 * function exists so the convention is applied in exactly one place. The number
 * was previously computed independently on /brokerage, in
 * getCapitalAllocationBasis and inside the NAV attribution, and the three
 * drifted apart by the platform P&L term.
 *
 * Fees, bonuses and interest are cumulative to today rather than to the locked
 * week: an obligation already settled in cash has still been borne by the pot,
 * so netting it back would hand the money over twice.
 *
 * The pot is reported as two capital accounts - realised and unrealised - which
 * sum to the same `balance` this function has always returned. Only the realised
 * account may be withdrawn: the unrealised half is a mark on money still sitting
 * at a broker and still being traded, so it is shown, never paid out.
 */
/**
 * Every non-equity cash flow, in date order, grouped by platform.
 *
 * `getPlatformFundingPositions` sums these into a net position, which is all NAV
 * needs. Realisation needs the sequence instead: what matters is the lowest
 * point net invested ever reached, and a sum cannot tell you that.
 */
async function getNonEquityCashFlowsByPlatform() {
  const res = await sql`
    WITH transaction_flows AS (
      SELECT
        pt.id,
        pt.platform_id,
        pt.date,
        pt.created_at,
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN COUNT(pta.id) > 0 THEN COALESCE(SUM(CASE WHEN pta.funding_source IN ('fixed_savings', 'brokerage') THEN pta.base_amount ELSE 0 END), 0)
          WHEN COALESCE(pt.funding_source, 'equity') IN ('fixed_savings', 'brokerage') AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN COALESCE(pt.funding_source, 'equity') IN ('fixed_savings', 'brokerage') AND pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as non_equity_cash_flow
      FROM platform_transactions pt
      LEFT JOIN platform_transaction_allocations pta ON pta.transaction_id = pt.id
      GROUP BY pt.id
    )
    SELECT platform_id, non_equity_cash_flow
    FROM transaction_flows
    WHERE non_equity_cash_flow <> 0
    ORDER BY platform_id, date ASC, created_at ASC
  `;

  const byPlatform = new Map<string, number[]>();
  for (const row of res.rows as { platform_id: string; non_equity_cash_flow: string }[]) {
    const flows = byPlatform.get(row.platform_id) ?? [];
    flows.push(parseFloat(row.non_equity_cash_flow || "0"));
    byPlatform.set(row.platform_id, flows);
  }
  return byPlatform;
}

/**
 * Platforms whose broker account has been shut.
 *
 * Read from an explicit flag rather than inferred from a zero mark: an unvalued
 * platform and a dead one are indistinguishable by value alone, and guessing
 * wrong in either direction is expensive. Guessing a live account is dead writes
 * off money that is still there; guessing a dead one is live leaves its loss
 * classified as a mark that might still recover, so the pot never realises it.
 */
async function getClosedPlatformIds() {
  const res = await sql`SELECT id FROM platforms WHERE closed_on IS NOT NULL`;
  return new Set((res.rows as { id: string }[]).map((row) => row.id));
}

export async function getBrokerageBalance() {
  await ensureAuditColumns();
  const [totals, savingsRows, rateInput, nonEquityFlows, closedPlatforms] = await Promise.all([
    sql`
      WITH latest_nav AS (
        SELECT id FROM nav_weeks WHERE status = 'locked' ORDER BY week_ending DESC LIMIT 1
      )
      SELECT
        COALESCE((
          SELECT SUM(nwps.brokerage_profit_loss)
          FROM nav_week_platform_snapshots nwps
          WHERE nwps.nav_week_id = (SELECT id FROM latest_nav)
        ), 0) as platform_profit_loss,
        COALESCE((
          SELECT SUM(fee_amount) FROM performance_fees WHERE audit_status <> 'reverted'
        ), 0) as performance_fees,
        COALESCE((
          SELECT SUM(amount) FROM bonus_payments
          WHERE audit_status = 'active' AND ledger_type = 'equity'
        ), 0) as equity_bonuses,
        COALESCE((
          SELECT SUM(amount) FROM bonus_payments
          WHERE audit_status = 'active' AND ledger_type = 'fixed_savings'
        ), 0) as fixed_savings_bonuses,
        COALESCE((
          SELECT SUM(amount) FROM brokerage_withdrawals
          WHERE audit_status = 'active' AND type = 'CASH'
        ), 0) as withdrawals,
        (SELECT id FROM latest_nav) IS NOT NULL as has_locked_nav
    `,
    sql`
      SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      WHERE audit_status = 'active'
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `,
    getFixedSavingsRateInputs(),
    getNonEquityCashFlowsByPlatform(),
    getClosedPlatformIds(),
  ]);

  const row = totals.rows[0] ?? {};
  const savings = calculateFixedSavingsLiability(savingsRows.rows as FixedSavingsLedgerRow[], undefined, rateInput);
  const platformProfitLoss = parseFloat(row.platform_profit_loss || "0");
  const performanceFees = parseFloat(row.performance_fees || "0");
  const savingsInterest = savings.totalAccruedInterest;
  const bonuses = roundMoney(parseFloat(row.equity_bonuses || "0") + parseFloat(row.fixed_savings_bonuses || "0"));
  const withdrawals = parseFloat(row.withdrawals || "0");

  // Realised comes from cash flows alone, so it is exact right now and needs no
  // mark. The total it is split out of is on the locked-NAV basis, which is why
  // unrealised is the residual rather than a second independent figure - the two
  // must add back to the number NAV priced itself on. A sweep out of a broker
  // moves value and net invested by the same amount, so it converts unrealised
  // into realised without moving the total at all.
  const profit = splitNonEquityProfit({
    platforms: [...nonEquityFlows].map(([platformId, flows]) => ({
      flows,
      closed: closedPlatforms.has(platformId),
    })),
    totalProfitLoss: platformProfitLoss,
  });

  // Two capital accounts, not one balance with a memo line. Fees, interest,
  // bonuses and cash out are all settled or accrued, so they all land on the
  // realised side; only the mark is unrealised. The two still sum to exactly the
  // balance this function has always returned, which is what keeps NAV, the
  // brokerage claim and the availability card undisturbed.
  const realisedPot = roundMoney(
    profit.realised + performanceFees - savingsInterest - bonuses - withdrawals,
  );
  const unrealisedPot = profit.unrealised;
  const balance = roundMoney(realisedPot + unrealisedPot);

  return {
    platformProfitLoss: profit.total,
    platformProfitLossRealised: profit.realised,
    platformProfitLossUnrealised: profit.unrealised,
    performanceFees: roundMoney(performanceFees),
    savingsInterest: roundMoney(savingsInterest),
    bonuses,
    withdrawals: roundMoney(withdrawals),
    /** Distributable: profit actually converted to cash, net of what is owed. */
    realisedPot,
    /** At risk, and shown for that reason. Never distributable. */
    unrealisedPot,
    /**
     * No locked NAV means no mark, so the total is zero and unrealised is just
     * the negative of realised. The arithmetic is still sound - the balance is
     * exactly what it was before the split existed - but the split itself has
     * nothing behind it, so the UI must not read anything into it.
     */
    hasLockedNav: Boolean(row.has_locked_nav),
    balance,
    /**
     * The dual test. Cash out may exceed neither what has been realised nor what
     * the pot is worth in total - the second limb is what stops a distribution
     * out of a pot whose mark has since gone underwater.
     */
    withdrawable: Math.max(0, roundMoney(Math.min(realisedPot, balance))),
  };
}

/**
 * Take cash out of the brokerage pot.
 *
 * Money genuinely leaves the fund, so both legs are written: the pot is reduced
 * and the recorded bank balance falls by the same amount. Writing only the pot
 * leg would leave the bank holding cash nobody claims, and equity - the residual
 * owner - would silently absorb it.
 *
 * Capped at realised profit. See `getBrokerageBalance` for why the unrealised
 * half is shown but never paid out.
 */
export async function recordBrokerageWithdrawal(input: {
  date: string;
  amount: number;
  notes?: string;
}) {
  await requireAdmin();
  await ensureAuditColumns();
  assertNotFutureDate(input.date, "Withdrawal date");

  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Withdrawal amount must be a positive number.");
  }

  const pot = await getBrokerageBalance();
  // Realised profit only. Unrealised profit is a mark on money still at a
  // broker and still being traded, and paying it out would hand over cash the
  // fund does not hold - equity, as residual claimant, would carry the gap.
  if (pot.withdrawable <= 0) {
    throw new Error(
      pot.realisedPot < 0
        ? `The brokerage pot is in deficit by RM ${Math.abs(pot.realisedPot).toFixed(2)} against realised profit. It must be recovered before any further withdrawal.`
        : `The brokerage pot holds no realised profit to withdraw. Realised is RM ${pot.realisedPot.toFixed(2)} and its total balance is RM ${pot.balance.toFixed(2)}.`,
    );
  }
  if (amount > pot.withdrawable) {
    throw new Error(
      `Withdrawal of RM ${amount.toFixed(2)} exceeds the RM ${pot.withdrawable.toFixed(2)} of realised profit available. Unrealised profit of RM ${pot.unrealisedPot.toFixed(2)} cannot be withdrawn.`,
    );
  }

  const cash = await getFundCashAsOf(input.date);
  const nextBalance = roundMoney(cash.balance - amount);
  if (cash && nextBalance < 0) {
    throw new Error(
      `The fund's bank balance on ${input.date} is RM ${cash.balance.toFixed(2)}, which cannot cover a withdrawal of RM ${amount.toFixed(2)}.`,
    );
  }

  // The two legs cannot share a transaction, because recordFundCash runs its own
  // guards and audit writes on the pooled connection. So the condition that
  // actually rejects it - a locked NAV at or after this date - is checked before
  // either leg is written. Without this the pot leg commits and the cash leg
  // throws, which is precisely how the pot and the bank drift apart.
  const blockingLock = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending >= ${input.date}
    ORDER BY week_ending ASC
    LIMIT 1
  `;
  if (blockingLock.rows.length > 0) {
    throw new Error(
      `NAV week ${blockingLock.rows[0].week_ending} is locked and already priced this period. Date the withdrawal after it.`,
    );
  }

  await withTransaction(async (db) => {
    await db`
      INSERT INTO brokerage_withdrawals (date, amount, type, notes)
      VALUES (${input.date}, ${amount}, 'CASH', ${input.notes || ""})
    `;
  });
  // Outside the transaction: recordFundCash runs its own locked-week checks
  // and audit writes, and throws with a message the operator can act on.
  await recordFundCash({
    asOfDate: input.date,
    balance: nextBalance,
    notes: `Brokerage withdrawal of RM ${amount.toFixed(2)}`,
  });

  return { amount, balanceAfter: roundMoney(pot.balance - amount) };
}

export async function getBrokerageWithdrawals() {
  await requireAdmin();
  await ensureAuditColumns();
  const res = await sql`
    SELECT id, TO_CHAR(date, 'YYYY-MM-DD') as date, amount, type, notes, created_at
    FROM brokerage_withdrawals
    WHERE audit_status = 'active'
    ORDER BY date DESC, created_at DESC
  `;
  return res.rows;
}

export async function getFundCashAttribution(input: {
  asOfDate: string;
  bankBalance: number;
  nonEquityValueInPlatforms: number;
  nonEquityPlatformProfitLoss: number;
}): Promise<FundCashAttribution> {
  const [savingsRows, rateInput, potRows] = await Promise.all([
    sql`
      SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      WHERE audit_status = 'active' AND date <= ${input.asOfDate}
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `,
    getFixedSavingsRateInputs(),
    sql`
      SELECT
        COALESCE((
          SELECT SUM(fee_amount) FROM performance_fees
          WHERE audit_status <> 'reverted' AND date <= ${input.asOfDate}
        ), 0) as performance_fees,
        COALESCE((
          SELECT SUM(amount) FROM bonus_payments
          WHERE audit_status = 'active' AND ledger_type = 'equity' AND date <= ${input.asOfDate}
        ), 0) as equity_bonuses,
        COALESCE((
          SELECT SUM(amount) FROM bonus_payments
          WHERE audit_status = 'active' AND ledger_type = 'fixed_savings' AND date <= ${input.asOfDate}
        ), 0) as fixed_savings_bonuses
    `,
  ]);

  const fixedSavings = calculateFixedSavingsLiability(
    savingsRows.rows as FixedSavingsLedgerRow[],
    input.asOfDate,
    rateInput,
  );
  const pot = potRows.rows[0] ?? {};
  return calculateEquityFundCash({
    bankBalance: input.bankBalance,
    nonEquityValueInPlatforms: input.nonEquityValueInPlatforms,
    fixedSavingsLiability: fixedSavings.totalLiability,
    nonEquityPlatformProfitLoss: input.nonEquityPlatformProfitLoss,
    performanceFees: parseFloat(pot.performance_fees || "0"),
    cumulativeFixedSavingsInterest: fixedSavings.totalAccruedInterest,
    cumulativeFixedSavingsBonuses: parseFloat(pot.fixed_savings_bonuses || "0"),
    cumulativeEquityBonuses: parseFloat(pot.equity_bonuses || "0"),
  });
}

/**
 * Record what the fund's cash account held on a date. Same shape as a platform
 * value mark: re-recording a date replaces it rather than stacking duplicates.
 */
export async function recordFundCash(input: { asOfDate: string; balance: number; notes?: string }) {
  await requireAdmin();
  await ensureAuditColumns();
  assertNotFutureDate(input.asOfDate, "Fund cash date");

  if (!Number.isFinite(input.balance) || input.balance < 0) {
    throw new Error("Fund cash balance must be zero or a positive number.");
  }

  const blockingLock = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending >= ${input.asOfDate}
    ORDER BY week_ending ASC
    LIMIT 1
  `;
  if (blockingLock.rows.length > 0) {
    throw new Error(
      `NAV week ${blockingLock.rows[0].week_ending} is locked and already priced this period. Record the balance with a later date.`,
    );
  }

  const existing = await sql`
    SELECT balance FROM fund_cash_valuations
    WHERE as_of_date = ${input.asOfDate} AND audit_status = 'active'
  `;
  const previousBalance = existing.rows[0] ? parseFloat(existing.rows[0].balance) : null;
  const balance = roundMoney(input.balance);

  const res = await sql`
    INSERT INTO fund_cash_valuations (as_of_date, balance, notes)
    VALUES (${input.asOfDate}, ${balance}, ${input.notes || ""})
    ON CONFLICT (as_of_date) DO UPDATE SET
      balance = EXCLUDED.balance,
      notes = EXCLUDED.notes,
      -- The unique key ignores audit_status, so without this a re-record after
      -- a revert would quietly update a row no query can see.
      audit_status = 'active'
    RETURNING id
  `;

  await writeAuditEvent("fund_cash.record", "fund_cash_valuations", res.rows[0].id, {
    asOfDate: input.asOfDate,
    balance,
    previousBalance,
  });
  return { success: true, id: res.rows[0].id as string };
}

/**
 * Refuse to write a financial record beneath an already-locked NAV. That NAV
 * priced the period from the balances of the time; changing them underneath it
 * silently contradicts an immutable record.
 */
export async function assertNoLockedNavOnOrAfter(date: string, what = "this record") {
  const blockingLock = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending >= ${date}
    ORDER BY week_ending ASC
    LIMIT 1
  `;
  if (blockingLock.rows.length > 0) {
    throw new Error(
      `NAV week ${blockingLock.rows[0].week_ending} is locked and already priced this period. Date ${what} after it.`,
    );
  }
}

/** Stale AND material platforms that must be refreshed before settling capital. */
export async function getBlockingValuations(asOfDate: string) {
  const [preview, fundCash] = await Promise.all([
    buildNavPlatformPreview(asOfDate),
    getFundCashAsOf(asOfDate),
  ]);
  return blockingValuations(preview, fundCash.balance);
}

/**
 * Log what a platform was worth on a date. Re-recording the same date replaces
 * the value rather than stacking duplicates, so a correction is one entry.
 */
export async function recordPlatformValuation(input: {
  platformId: string;
  asOfDate: string;
  totalValue: number;
  source?: PlatformValuationSource;
  notes?: string;
}) {
  await requireAdmin();
  await ensureAuditColumns();
  assertNotFutureDate(input.asOfDate, "Valuation date");

  if (!Number.isFinite(input.totalValue) || input.totalValue < 0) {
    throw new Error("Platform value must be zero or a positive number.");
  }

  const platform = await sql`SELECT id, name FROM platforms WHERE id = ${input.platformId}`;
  if (platform.rows.length === 0) throw new Error("Platform not found.");

  // A locked NAV already consumed valuations up to its date; changing history
  // beneath it would silently contradict an immutable record.
  const blockingLock = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending >= ${input.asOfDate}
    ORDER BY week_ending ASC
    LIMIT 1
  `;
  if (blockingLock.rows.length > 0) {
    throw new Error(
      `NAV week ${blockingLock.rows[0].week_ending} is locked and already priced this period. Record the valuation with a later date.`,
    );
  }

  const existing = await sql`
    SELECT total_value FROM platform_valuations
    WHERE platform_id = ${input.platformId} AND as_of_date = ${input.asOfDate} AND audit_status = 'active'
  `;
  const previousValue = existing.rows[0] ? parseFloat(existing.rows[0].total_value) : null;
  const totalValue = roundMoney(input.totalValue);

  const res = await sql`
    INSERT INTO platform_valuations (platform_id, as_of_date, total_value, source, notes)
    VALUES (${input.platformId}, ${input.asOfDate}, ${totalValue}, ${input.source || "MANUAL"}, ${input.notes || ""})
    ON CONFLICT (platform_id, as_of_date) DO UPDATE SET
      total_value = EXCLUDED.total_value,
      source = EXCLUDED.source,
      notes = EXCLUDED.notes,
      -- See recordFundCash: the unique key ignores audit_status.
      audit_status = 'active'
    RETURNING id
  `;

  await writeAuditEvent("platform_valuation.record", "platform_valuations", res.rows[0].id, {
    platformId: input.platformId,
    platformName: platform.rows[0].name,
    asOfDate: input.asOfDate,
    totalValue,
    previousValue,
    source: input.source || "MANUAL",
  });
  return { success: true, id: res.rows[0].id as string };
}

/**
 * Shut a broker account: mark it at zero on the closing date and stamp it closed.
 *
 * Both legs, in one transaction. The zero valuation is what every historical NAV
 * on or after the date will read; the stamp is what tells the brokerage pot the
 * loss is realised rather than a mark that might still recover, and what stops
 * the account blocking NAV locks forever as a stale valuation nobody can refresh.
 */
export async function closePlatform(input: { platformId: string; asOfDate: string; notes?: string }) {
  await requireAdmin();
  await ensureAuditColumns();
  assertNotFutureDate(input.asOfDate, "Closing date");

  const platform = await sql`SELECT id, name, TO_CHAR(closed_on, 'YYYY-MM-DD') as closed_on FROM platforms WHERE id = ${input.platformId}`;
  if (platform.rows.length === 0) throw new Error("Platform not found.");
  if (platform.rows[0].closed_on) {
    throw new Error(`${platform.rows[0].name} was already closed on ${platform.rows[0].closed_on}.`);
  }

  // Same rule as recording a valuation: a locked week has already priced this
  // platform, and writing a zero beneath it would contradict an immutable record.
  const blockingLock = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending >= ${input.asOfDate}
    ORDER BY week_ending ASC
    LIMIT 1
  `;
  if (blockingLock.rows.length > 0) {
    throw new Error(
      `NAV week ${blockingLock.rows[0].week_ending} is locked and already priced this platform. Close it with a later date.`,
    );
  }

  await withTransaction(async (db) => {
    await db`
      INSERT INTO platform_valuations (platform_id, as_of_date, total_value, source, notes)
      VALUES (${input.platformId}, ${input.asOfDate}, 0, 'MANUAL', ${input.notes || "Account closed"})
      ON CONFLICT (platform_id, as_of_date) DO UPDATE SET
        total_value = 0,
        notes = EXCLUDED.notes,
        audit_status = 'active'
    `;
    await db`UPDATE platforms SET closed_on = ${input.asOfDate} WHERE id = ${input.platformId}`;
  });

  await writeAuditEvent("platform.close", "platforms", input.platformId, {
    platformName: platform.rows[0].name,
    closedOn: input.asOfDate,
    notes: input.notes || "",
  });
  return { success: true };
}

/**
 * Undo a close. The zero valuation it wrote is left in place deliberately - it
 * is a recorded mark like any other, and removing it would rewrite what the NAV
 * weeks between the close and now were priced on. Record a fresh valuation to
 * bring the platform back to a real value.
 */
export async function reopenPlatform(platformId: string) {
  await requireAdmin();
  await ensureAuditColumns();

  const platform = await sql`SELECT id, name, TO_CHAR(closed_on, 'YYYY-MM-DD') as closed_on FROM platforms WHERE id = ${platformId}`;
  if (platform.rows.length === 0) throw new Error("Platform not found.");
  const closedOn = platform.rows[0].closed_on as string | null;
  if (!closedOn) throw new Error(`${platform.rows[0].name} is not closed.`);

  const blockingLock = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending >= ${closedOn}
    ORDER BY week_ending ASC
    LIMIT 1
  `;
  if (blockingLock.rows.length > 0) {
    throw new Error(
      `NAV week ${blockingLock.rows[0].week_ending} is locked and was priced with this platform closed. Reopening it now would contradict that record.`,
    );
  }

  await sql`UPDATE platforms SET closed_on = NULL WHERE id = ${platformId}`;
  await writeAuditEvent("platform.reopen", "platforms", platformId, {
    platformName: platform.rows[0].name,
    wasClosedOn: closedOn,
  });
  return { success: true };
}

export async function getPlatformValuations(platformId?: string) {
  await requireAdmin();
  await ensureAuditColumns();
  const res = platformId
    ? await sql`
        SELECT pv.id, pv.platform_id, p.name as platform_name,
          TO_CHAR(pv.as_of_date, 'YYYY-MM-DD') as as_of_date,
          pv.total_value, pv.source, pv.notes, pv.created_at
        FROM platform_valuations pv
        JOIN platforms p ON p.id = pv.platform_id
        WHERE pv.audit_status = 'active' AND pv.platform_id = ${platformId}
        ORDER BY pv.as_of_date DESC
      `
    : await sql`
        SELECT pv.id, pv.platform_id, p.name as platform_name,
          TO_CHAR(pv.as_of_date, 'YYYY-MM-DD') as as_of_date,
          pv.total_value, pv.source, pv.notes, pv.created_at
        FROM platform_valuations pv
        JOIN platforms p ON p.id = pv.platform_id
        WHERE pv.audit_status = 'active'
        ORDER BY pv.as_of_date DESC, p.name ASC
      `;
  return res.rows;
}

/**
 * Each platform's net invested capital, split by funding source.
 *
 * `asOfDate` is not optional in practice: valuations are always resolved as of a
 * date, so summing transactions to *today* against a mark taken on the NAV week
 * prices the difference as profit or loss that had not happened yet. Locking a
 * week two days after it ended used to pick up every transaction booked in
 * those two days, understating platform P&L by their net and with it NAV per
 * unit. Both sides of `totalValue - netInvested` have to be struck on the same
 * date or the subtraction means nothing.
 */
async function getPlatformFundingPositions(asOfDate: string) {
  const platforms = await sql`
    WITH transaction_flows AS (
      SELECT
        pt.id,
        pt.platform_id,
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as cash_flow,
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN COUNT(pta.id) > 0 THEN COALESCE(SUM(CASE WHEN pta.funding_source = 'equity' THEN pta.base_amount ELSE 0 END), 0)
          WHEN COALESCE(pt.funding_source, 'equity') = 'equity' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN COALESCE(pt.funding_source, 'equity') = 'equity' AND pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as equity_cash_flow,
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN COUNT(pta.id) > 0 THEN COALESCE(SUM(CASE WHEN pta.funding_source = 'fixed_savings' THEN pta.base_amount ELSE 0 END), 0)
          WHEN COALESCE(pt.funding_source, 'equity') = 'fixed_savings' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN COALESCE(pt.funding_source, 'equity') = 'fixed_savings' AND pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as fixed_savings_cash_flow,
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN COUNT(pta.id) > 0 THEN COALESCE(SUM(CASE WHEN pta.funding_source = 'brokerage' THEN pta.base_amount ELSE 0 END), 0)
          WHEN COALESCE(pt.funding_source, 'equity') = 'brokerage' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN COALESCE(pt.funding_source, 'equity') = 'brokerage' AND pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as brokerage_cash_flow,
        -- Gross contributions ignore withdrawals, so the profit split survives
        -- principal being taken back out. Allocation rows are signed, so
        -- inflows are the positive ones.
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN COUNT(pta.id) > 0 THEN COALESCE(SUM(CASE WHEN pta.funding_source = 'equity' AND pta.base_amount > 0 THEN pta.base_amount ELSE 0 END), 0)
          WHEN COALESCE(pt.funding_source, 'equity') = 'equity' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as equity_contributed,
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN COUNT(pta.id) > 0 THEN COALESCE(SUM(CASE WHEN pta.funding_source = 'fixed_savings' AND pta.base_amount > 0 THEN pta.base_amount ELSE 0 END), 0)
          WHEN COALESCE(pt.funding_source, 'equity') = 'fixed_savings' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as fixed_savings_contributed,
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN COUNT(pta.id) > 0 THEN COALESCE(SUM(CASE WHEN pta.funding_source = 'brokerage' AND pta.base_amount > 0 THEN pta.base_amount ELSE 0 END), 0)
          WHEN COALESCE(pt.funding_source, 'equity') = 'brokerage' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END as brokerage_contributed
      FROM platform_transactions pt
      LEFT JOIN platform_transaction_allocations pta ON pta.transaction_id = pt.id
      WHERE pt.date <= ${asOfDate}
      GROUP BY pt.id
    )
    SELECT
      p.id,
      p.name,
      TO_CHAR(p.closed_on, 'YYYY-MM-DD') as closed_on,
      COALESCE(SUM(tf.cash_flow), 0) as net_invested,
      COALESCE(SUM(tf.equity_cash_flow), 0) as equity_net_invested,
      COALESCE(SUM(tf.fixed_savings_cash_flow), 0) as fixed_savings_net_invested,
      COALESCE(SUM(tf.brokerage_cash_flow), 0) as brokerage_net_invested,
      COALESCE(SUM(tf.equity_contributed), 0) as equity_contributed,
      COALESCE(SUM(tf.fixed_savings_contributed), 0) as fixed_savings_contributed,
      COALESCE(SUM(tf.brokerage_contributed), 0) as brokerage_contributed
    FROM platforms p
    LEFT JOIN transaction_flows tf ON tf.platform_id = p.id
    GROUP BY p.id, p.name, p.closed_on
    ORDER BY p.name
  `;

  return platforms.rows.map((platform: any) => ({
    id: platform.id as string,
    name: platform.name as string,
    // A platform closed on or before the date is worth nothing on it. Closed
    // later, it was still live then, so its marks still apply.
    closed: Boolean(platform.closed_on) && platform.closed_on <= asOfDate,
    closedOn: (platform.closed_on as string | null) ?? null,
    netInvested: roundMoney(parseFloat(platform.net_invested || "0")),
    equityNetInvested: roundMoney(parseFloat(platform.equity_net_invested || "0")),
    fixedSavingsNetInvested: roundMoney(parseFloat(platform.fixed_savings_net_invested || "0")),
    brokerageNetInvested: roundMoney(parseFloat(platform.brokerage_net_invested || "0")),
    equityContributed: roundMoney(parseFloat(platform.equity_contributed || "0")),
    fixedSavingsContributed: roundMoney(parseFloat(platform.fixed_savings_contributed || "0")),
    brokerageContributed: roundMoney(parseFloat(platform.brokerage_contributed || "0")),
  }));
}

/**
 * Split each previewed platform's value across the pools that funded it. Shared
 * by the NAV review screen and by createNavWeek so what the operator reviews is
 * arithmetically the same thing that gets locked.
 */
export function summarizeNavPlatformPreview(preview: NavPlatformPreview[]) {
  return preview.map((platform) => {
    const allocation = calculateBrokerageFundingAllocation({
      equityNetInvested: platform.equityNetInvested,
      fixedSavingsNetInvested: platform.fixedSavingsNetInvested,
      brokerageNetInvested: platform.brokerageNetInvested,
      equityContributed: platform.equityContributed,
      fixedSavingsContributed: platform.fixedSavingsContributed,
      brokerageContributed: platform.brokerageContributed,
      totalValue: platform.totalValue,
    });
    return {
      platformId: platform.platformId,
      netInvested: allocation.equityNetInvested,
      unrealizedProfit: allocation.equityProfitLoss,
      totalValue: platform.totalValue,
      valuationDate: platform.valuationDate,
      valuationSource: platform.source,
      valuationAgeDays: platform.ageDays ?? 0,
      weightPercent: platform.weightPercent,
      allocation,
    };
  });
}

/** Equity's share of platform value, and the share belonging to everyone else. */
export function splitNavPlatformValue(snapshots: ReturnType<typeof summarizeNavPlatformPreview>) {
  return {
    equityPlatformValue: roundMoney(
      snapshots.reduce((sum, snapshot) => sum + snapshot.allocation.equityNavValue, 0),
    ),
    nonEquityValueInPlatforms: roundMoney(
      snapshots.reduce((sum, snapshot) => sum + (snapshot.totalValue - snapshot.allocation.equityNavValue), 0),
    ),
    nonEquityPlatformProfitLoss: roundMoney(
      snapshots.reduce((sum, snapshot) => sum + snapshot.allocation.brokerageProfitLoss, 0),
    ),
    // Savers' principal only. Their share of the platform's profit is not theirs
    // - the pot carries it, which is why the whole non-equity profit above goes
    // into the brokerage claim. Used to charge each pool for what it deployed.
    fixedSavingsPrincipalInPlatforms: roundMoney(
      snapshots.reduce((sum, snapshot) => sum + snapshot.allocation.fixedSavingsNetInvested, 0),
    ),
    // Principal deployed under the brokerage funding source. calculateEquityFundCash
    // builds the brokerage claim from earnings alone and has no term for principal
    // the pot contributed, so this amount is deployed with nothing crediting it -
    // equity silently absorbs it as residual owner. Reported so the availability
    // view can say the brokerage figure is unreliable and by exactly how much,
    // rather than presenting the shortfall as a real overdraft.
    brokeragePrincipalInPlatforms: roundMoney(
      snapshots.reduce((sum, snapshot) => sum + snapshot.allocation.brokerageNetInvested, 0),
    ),
  };
}

/**
 * How much cash each pool has free to deploy right now.
 *
 * `getFundCashAttribution` answers who owns the bank balance; this answers
 * whether the money is actually spendable, by charging each pool for the capital
 * it already has sitting in a platform. Shown before funding a platform so the
 * operator is not allocating from a pool that has nothing left.
 */
export async function getFundCashAvailability(asOfDate?: string) {
  await requireAdmin();
  const date = asOfDate ?? todayIso();
  const [preview, fundCash] = await Promise.all([
    buildNavPlatformPreview(date),
    getFundCashAsOf(date),
  ]);
  const valueSplit = splitNavPlatformValue(summarizeNavPlatformPreview(preview));
  // The pot's balance comes from the shared function on the locked-NAV basis, so
  // this card, /brokerage and the funding dialog all quote the same number.
  const [savings, pot] = await Promise.all([
    getFixedSavingsLiabilityAsOf(date),
    getBrokerageBalance(),
  ]);

  const availability = splitPoolAvailability({
    bankBalance: fundCash.balance,
    equityValueInPlatforms: valueSplit.equityPlatformValue,
    fixedSavingsLiability: savings.totalLiability,
    fixedSavingsPrincipalInPlatforms: valueSplit.fixedSavingsPrincipalInPlatforms,
    brokerageBalance: pot.balance,
    brokerageDeployedInPlatforms: roundMoney(
      valueSplit.nonEquityValueInPlatforms - valueSplit.fixedSavingsPrincipalInPlatforms,
    ),
  });

  return {
    asOfDate: date,
    // Carries NEVER_RECORDED through so the UI can say the balance is unknown
    // rather than presenting an unrecorded zero as a real one.
    fundCashSource: fundCash.source,
    ...availability,
    brokerage: {
      ...availability.brokerage,
      // Non-zero means the brokerage available figure cannot be trusted: this
      // much principal is deployed with no matching claim behind it.
      unbackedPrincipal: valueSplit.brokeragePrincipalInPlatforms,
    },
  };
}

/**
 * The values an unsaved-over draft already holds for its own overrides.
 *
 * A draft's overrides are no longer value marks, so reopening the review screen
 * cannot find them by pricing the date again. Without this the Override column
 * comes back empty and the next Save draft recomputes the week from carried
 * forward values, silently discarding what was typed.
 */
export async function getDraftNavOverrides(weekEnding: string) {
  const res = await sql`
    SELECT nwps.platform_id, nwps.total_value
    FROM nav_week_platform_snapshots nwps
    JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
    WHERE nw.week_ending = ${weekEnding} AND nw.status = 'draft' AND nwps.is_override = TRUE
  `;
  return res.rows.map((row) => ({
    platformId: row.platform_id as string,
    totalValue: roundMoney(parseFloat(row.total_value || "0")),
  }));
}

export async function createNavWeek(input: NavWeekInput) {
  const existingWeek = await sql`SELECT status FROM nav_weeks WHERE week_ending = ${input.weekEnding}`;
  if (existingWeek.rows[0]?.status === "locked") {
    throw new Error("Locked NAV weeks cannot be modified.");
  }
  const totalUnits = await getTotalUnits();

  // Overrides are optional now: an omitted platform is valued from its recorded
  // valuations or computed holdings rather than requiring fresh input.
  const overrides = new Map<string, { totalValue?: number; unrealizedProfit?: number }>();
  for (const snapshot of input.platformSnapshots ?? []) {
    overrides.set(snapshot.platformId, {
      totalValue: snapshot.totalValue,
      unrealizedProfit: snapshot.unrealizedProfit,
    });
  }

  const preview = await buildNavPlatformPreview(input.weekEnding, overrides);
  const platformSnapshots = summarizeNavPlatformPreview(preview);
  // Cash the fund holds outside every platform. Recording it here is what
  // stops money withdrawn from a broker from disappearing out of gross assets
  // between the withdrawal and its redeployment.
  const fundCashPreview = await getFundCashAsOf(input.weekEnding);
  const fundCash = input.fundCash !== undefined ? roundMoney(input.fundCash) : fundCashPreview.balance;
  // The review screen pre-fills this box from the ledgers, so a submitted value
  // is not by itself a claim about the bank. Recording every one of them made
  // saving a NAV plant a cash anchor the admin never checked - one that
  // survives deleting the draft, and that recordFundCash refuses outright when
  // a later NAV is locked. Only a balance the admin actually edited is written.
  if (input.fundCashConfirmed && input.fundCash !== undefined && input.fundCash !== fundCashPreview.balance) {
    await recordFundCash({
      asOfDate: input.weekEnding,
      balance: fundCash,
      notes: "Recorded while creating NAV",
    });
  }
  // Only equity's share of the bank balance may price equity units. The rest
  // belongs to savers and to the brokerage pot, and counting it here inflated
  // NAV per unit by every ringgit of their money the fund happened to hold.
  const valueSplit = splitNavPlatformValue(platformSnapshots);
  const attribution = await getFundCashAttribution({
    asOfDate: input.weekEnding,
    bankBalance: fundCash,
    nonEquityValueInPlatforms: valueSplit.nonEquityValueInPlatforms,
    nonEquityPlatformProfitLoss: valueSplit.nonEquityPlatformProfitLoss,
  });
  const grossAssets = roundMoney(valueSplit.equityPlatformValue + attribution.equity);
  const liabilities = 0;
  const netAssetValue = roundMoney(grossAssets - liabilities + input.adjustments);
  const navPerUnit = calculateNavPerUnit({ netAssetValue, totalUnits });
  const settlementDate = input.settlementDate || input.weekEnding;

  // The NAV row and its platform snapshots are one record. The snapshots are
  // deleted and reinserted on re-save, so a failure between the two would leave
  // a NAV with no platform detail behind it - and that detail is what the
  // settlement staleness guard reads.
  await withTransaction(async (db) => {
  const res = await db`
    INSERT INTO nav_weeks (
      week_ending, settlement_date, gross_assets, fund_cash, equity_fund_cash, liabilities, adjustments,
      net_asset_value, total_units, nav_per_unit, status, notes
    )
    VALUES (
      ${input.weekEnding}, ${settlementDate}, ${grossAssets}, ${fundCash}, ${attribution.equity}, ${liabilities}, ${input.adjustments},
      ${netAssetValue}, ${totalUnits}, ${navPerUnit}, 'draft', ${input.notes || ""}
    )
    ON CONFLICT (week_ending) DO UPDATE SET
      settlement_date = EXCLUDED.settlement_date,
      gross_assets = EXCLUDED.gross_assets,
      fund_cash = EXCLUDED.fund_cash,
      equity_fund_cash = EXCLUDED.equity_fund_cash,
      liabilities = EXCLUDED.liabilities,
      adjustments = EXCLUDED.adjustments,
      net_asset_value = EXCLUDED.net_asset_value,
      total_units = EXCLUDED.total_units,
      nav_per_unit = EXCLUDED.nav_per_unit,
      notes = EXCLUDED.notes
    RETURNING id
  `;
  const navWeekId = res.rows[0].id as string;
  // A value typed into the review screen is only a proposal until the NAV is
  // locked. Recording it as a real value mark here meant an unlocked draft -
  // one nobody had committed to, and one Delete Draft was supposed to undo -
  // immediately priced every later NAV. lockNavWeek writes the marks instead,
  // because that is the point at which this NAV becomes the authority for its
  // own date. All this has to do is remember which rows the admin typed.
  const overriddenPlatformIds = new Set(
    (input.platformSnapshots ?? [])
      .filter((snapshot) => snapshot.totalValue !== undefined)
      .map((snapshot) => snapshot.platformId),
  );
  await db`DELETE FROM nav_week_platform_snapshots WHERE nav_week_id = ${navWeekId}`;
  for (const snapshot of platformSnapshots) {
    await db`
      INSERT INTO nav_week_platform_snapshots (
        nav_week_id, platform_id, net_invested, unrealized_profit, total_value,
        equity_net_invested, fixed_savings_net_invested, brokerage_net_invested,
        equity_unrealized_profit, brokerage_profit_loss,
        valuation_date, valuation_source, valuation_age_days, weight_percent, is_override
      )
      VALUES (
        ${navWeekId}, ${snapshot.platformId}, ${snapshot.netInvested}, ${snapshot.unrealizedProfit}, ${snapshot.totalValue},
        ${snapshot.allocation.equityNetInvested}, ${snapshot.allocation.fixedSavingsNetInvested}, ${snapshot.allocation.brokerageNetInvested},
        ${snapshot.allocation.equityProfitLoss}, ${snapshot.allocation.brokerageProfitLoss},
        ${snapshot.valuationDate}, ${snapshot.valuationSource}, ${snapshot.valuationAgeDays}, ${snapshot.weightPercent},
        ${overriddenPlatformIds.has(snapshot.platformId)}
      )
    `;
  }
  await writeAuditEvent("nav_week.upsert", "nav_weeks", navWeekId, {
    weekEnding: input.weekEnding,
    grossAssets,
    fundCash,
    fundCashExpected: fundCashPreview.expectedBalance,
    // Who owned the bank balance on this date, so the unit price can be
    // re-derived later without re-running the whole calculation.
    cashAttribution: attribution,
    platformCount: platformSnapshots.length,
    // Record where each value came from, so a later reviewer can tell a fresh
    // mark from a carried-forward one without re-deriving it.
    valuationSources: platformSnapshots.map((snapshot) => ({
      platformId: snapshot.platformId,
      source: snapshot.valuationSource,
      valuationDate: snapshot.valuationDate,
    })),
    staleCount: preview.filter((platform) => platform.isStale).length,
  }, db);
  });
  return { success: true, preview, fundCash: fundCashPreview, attribution };
}

export async function lockNavWeek(id: string) {
  const navWeek = await sql`
    SELECT id, TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending, status
    FROM nav_weeks
    WHERE id = ${id}
  `;
  const draft = navWeek.rows[0];
  if (!draft) throw new Error("NAV week not found.");
  if (draft.status !== "draft") throw new Error("Only draft NAV weeks can be locked.");

  const latestLocked = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked'
    ORDER BY week_ending DESC
    LIMIT 1
  `;
  const latestWeekEnding = latestLocked.rows[0]?.week_ending;
  if (latestWeekEnding && draft.week_ending <= latestWeekEnding) {
    throw new Error(`NAV week must be later than the latest locked NAV week (${latestWeekEnding}).`);
  }

  // Locking is what turns a proposal into the record: it prices real deposits
  // and withdrawals, and it is where the values typed into the Override column
  // finally become value marks. Both happen together or neither does - a NAV
  // locked without its marks would be the desync this whole mechanism exists to
  // prevent, and marks written without the lock are what made an abandoned
  // draft price the next NAV.
  const { pricing, recordedMarks } = await withTransaction(async (db) => {
    const locked = await db`
      UPDATE nav_weeks SET status = 'locked', locked_at = NOW()
      WHERE id = ${id} AND status = 'draft'
      RETURNING gross_assets, net_asset_value, total_units, nav_per_unit
    `;
    if (locked.rows.length === 0) throw new Error("Only draft NAV weeks can be locked.");

    // Only the rows the admin actually typed. Everything else on this NAV was
    // resolved from marks that already exist, and re-stamping those as
    // NAV_REVIEW would rewrite their provenance for no gain.
    const overrides = await db`
      SELECT nwps.platform_id, nwps.total_value, p.name as platform_name
      FROM nav_week_platform_snapshots nwps
      JOIN platforms p ON p.id = nwps.platform_id
      WHERE nwps.nav_week_id = ${id} AND nwps.is_override = TRUE
    `;

    const marks = [];
    for (const override of overrides.rows) {
      const totalValue = roundMoney(parseFloat(override.total_value || "0"));
      const existing = await db`
        SELECT total_value FROM platform_valuations
        WHERE platform_id = ${override.platform_id} AND as_of_date = ${draft.week_ending} AND audit_status = 'active'
      `;
      const previousValue = existing.rows[0] ? roundMoney(parseFloat(existing.rows[0].total_value)) : null;
      // recordPlatformValuation is bypassed on purpose: its locked-NAV guard
      // stops history moving under a priced period, and the NAV being locked
      // here is the authority for its own date.
      const recorded = await db`
        INSERT INTO platform_valuations (platform_id, as_of_date, total_value, source, notes)
        VALUES (${override.platform_id}, ${draft.week_ending}, ${totalValue}, 'NAV_REVIEW', 'Entered on the NAV review screen')
        ON CONFLICT (platform_id, as_of_date) DO UPDATE SET
          total_value = EXCLUDED.total_value,
          source = EXCLUDED.source,
          notes = EXCLUDED.notes,
          audit_status = 'active'
        RETURNING id
      `;
      // recordPlatformValuation is also where the audit event lives, so the
      // event is written here too. Without it a value entered through the NAV
      // screen is invisible to anyone filtering the log for valuation changes.
      await writeAuditEvent(
        "platform_valuation.record",
        "platform_valuations",
        recorded.rows[0].id,
        {
          platformId: override.platform_id,
          platformName: override.platform_name,
          asOfDate: draft.week_ending,
          totalValue,
          previousValue,
          source: "NAV_REVIEW",
        },
        db,
      );
      marks.push({ platformId: override.platform_id, totalValue });
    }
    return { pricing: locked.rows[0], recordedMarks: marks };
  });

  // The audit row carries the numbers it fixed rather than only the id.
  await writeAuditEvent("nav_week.lock", "nav_weeks", id, {
    weekEnding: draft.week_ending,
    grossAssets: roundMoney(parseFloat(pricing.gross_assets || "0")),
    netAssetValue: roundMoney(parseFloat(pricing.net_asset_value || "0")),
    totalUnits: roundUnits(parseFloat(pricing.total_units || "0")),
    navPerUnit: parseFloat(pricing.nav_per_unit || "0"),
    recordedValuations: recordedMarks,
  });
  return { success: true };
}

export async function deleteDraftNavWeek(id: string) {
  const navWeek = await sql`
    SELECT id, status
    FROM nav_weeks
    WHERE id = ${id}
  `;
  const draft = navWeek.rows[0];
  if (!draft) throw new Error("NAV week not found.");
  if (draft.status !== "draft") throw new Error("Locked NAV weeks are immutable and cannot be deleted.");

  // Deleting the NAV row cascades its platform snapshots away, but value marks
  // have no such link. Drafts no longer write any - lockNavWeek does - so for a
  // draft created by the current code there is nothing here to void. This stays
  // as a repair path: databases written before that change still hold NAV_REVIEW
  // marks left behind by drafts, and deleting such a draft should still take its
  // figures back out rather than let the next NAV carry them forward. Both
  // halves are one transaction: a delete that only half-happened is exactly the
  // state this guards against.
  const { removed, voided } = await withTransaction(async (db) => {
    // The row is gone after this, so what it held is only recoverable from the
    // audit event. Return it from the DELETE rather than re-reading it first.
    const deleted = await db`
      DELETE FROM nav_weeks WHERE id = ${id} AND status = 'draft'
      RETURNING TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending, gross_assets, net_asset_value, nav_per_unit
    `;
    if (deleted.rows.length === 0) throw new Error("Only draft NAV weeks can be deleted.");
    const removedWeek = deleted.rows[0];

    // Only marks this screen wrote for this date. A MANUAL mark on the same date
    // was recorded on its own authority and is not this draft's to withdraw.
    //
    // Known gap: if the override overwrote a MANUAL mark on exactly this date,
    // the upsert in createNavWeek already replaced it, so voiding here does not
    // bring the old value back - it is only recoverable from the
    // platform_valuation.record audit event's previousValue.
    const reversed = await db`
      UPDATE platform_valuations SET audit_status = 'voided'
      WHERE as_of_date = ${removedWeek.week_ending}
        AND source = 'NAV_REVIEW'
        AND audit_status = 'active'
      RETURNING platform_id, total_value
    `;
    return { removed: removedWeek, voided: reversed.rows };
  });

  await writeAuditEvent("nav_week.delete_draft", "nav_weeks", id, {
    weekEnding: removed.week_ending,
    grossAssets: roundMoney(parseFloat(removed.gross_assets || "0")),
    netAssetValue: roundMoney(parseFloat(removed.net_asset_value || "0")),
    navPerUnit: parseFloat(removed.nav_per_unit || "0"),
    // What the delete took back out of the valuation history. Without this the
    // log shows a NAV disappearing and says nothing about the marks that went
    // with it.
    voidedValuations: voided.map((row) => ({
      platformId: row.platform_id,
      totalValue: roundMoney(parseFloat(row.total_value || "0")),
    })),
  });
  return { success: true };
}

/**
 * Latest locked NAV on or before a date. Pricing a backdated movement at
 * today's NAV would issue or redeem units at the wrong price, so the NAV in
 * force on the movement date is the correct one.
 */
export async function getLockedNavWeekForDate(date: string) {
  const res = await sql`
    SELECT id,
      TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending,
      TO_CHAR(settlement_date, 'YYYY-MM-DD') as settlement_date,
      gross_assets, fund_cash, equity_fund_cash, liabilities, adjustments, net_asset_value,
      total_units, nav_per_unit, status, locked_at, notes, created_at
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending <= ${date}
    ORDER BY nav_weeks.week_ending DESC
    LIMIT 1
  `;
  return res.rows[0] ?? null;
}

/**
 * Refuse to settle capital against a NAV whose pricing rests on valuations that
 * are both stale and material. Mispricing here silently moves value between
 * investors, which is exactly what unit accounting exists to prevent.
 */
async function assertNavIsSettlementGrade(navWeekId: string, weekEnding: string) {
  const res = await sql`
    SELECT p.name, nwps.valuation_age_days, nwps.weight_percent, TO_CHAR(nwps.valuation_date, 'YYYY-MM-DD') as valuation_date
    FROM nav_week_platform_snapshots nwps
    JOIN platforms p ON p.id = nwps.platform_id
    WHERE nwps.nav_week_id = ${navWeekId}
      AND nwps.valuation_age_days > ${STALE_AFTER_DAYS}
      AND nwps.weight_percent >= ${MATERIAL_WEIGHT_PERCENT}
    ORDER BY nwps.weight_percent DESC
  `;
  if (res.rows.length === 0) return;

  const detail = res.rows
    .map(
      (row: any) =>
        `${row.name} (${Number(row.weight_percent).toFixed(1)}% of the fund, valued ${row.valuation_date ?? "never"}, ${row.valuation_age_days} days old)`,
    )
    .join("; ");
  throw new Error(
    `Cannot settle capital against the NAV of ${weekEnding}: ${detail}. Record a current valuation for these platforms and create a new NAV before settling.`,
  );
}

/**
 * An investor's units and remaining cost basis as they stood on a date.
 *
 * The date bound matters: a backdated movement is priced at the NAV in force on
 * its own date, so validating it against today's balance would let units issued
 * later be redeemed before they existed.
 */
async function getEquityPositionAsOf(investorId: string, date: string) {
  const priorLedger = await sql`
    SELECT iul.type, iul.units, iul.gross_amount, iul.audit_status, TO_CHAR(iul.date, 'YYYY-MM-DD') as date,
      CASE WHEN bp.id IS NULL THEN false ELSE true END as is_bonus
    FROM investor_unit_ledger iul
    LEFT JOIN bonus_payments bp ON bp.source_id = iul.id AND bp.ledger_type = 'equity'
    WHERE iul.investor_id = ${investorId}
      AND iul.audit_status = 'active'
      AND iul.date <= ${date}
    ORDER BY iul.date ASC, iul.created_at ASC
  `;
  return calculateEquityCapitalPosition(priorLedger.rows as EquityUnitLedgerRow[]);
}

/**
 * Redeem units to cover a settled profit claim.
 *
 * Paying a claim in cash without redeeming anything left the claimant holding
 * the units that produced the profit while the cash leaving the bank lowered
 * NAV per unit for everyone. Redeeming makes the claimant carry their own
 * payout: their position falls by the gross amount crystallized, they receive
 * the net, and the fee stays with the fund exactly as on a withdrawal.
 */
export async function redeemUnitsForProfitClaim(input: {
  investorId: string;
  date: string;
  grossAmount: number;
  feeAmount: number;
  notes: string;
}, db: SqlExecutor = sql) {
  await ensureAuditColumns();
  assertNotFutureDate(input.date, "Settlement date");

  const navWeek = await getLockedNavWeekForDate(input.date);
  if (!navWeek) {
    throw new Error(
      `No locked NAV exists on or before ${input.date}. Lock a NAV dated on or before the settlement before settling a claim.`,
    );
  }
  await assertNavIsSettlementGrade(navWeek.id, navWeek.week_ending);

  const navPerUnit = parseFloat(navWeek.nav_per_unit);
  const grossAmount = roundMoney(input.grossAmount);
  const feeAmount = roundMoney(input.feeAmount);
  const netAmount = roundMoney(grossAmount - feeAmount);
  const position = await getEquityPositionAsOf(input.investorId, input.date);
  const redemption = redeemUnitsForWithdrawal({
    requestedAmount: grossAmount,
    navPerUnit,
    availableUnits: roundUnits(position.units),
  });

  const unitLedger = await db`
    INSERT INTO investor_unit_ledger (investor_id, nav_week_id, date, type, units, nav_per_unit, gross_amount, notes)
    VALUES (
      ${input.investorId}, ${navWeek.id}, ${input.date}, 'UnitRedemption',
      ${redemption.unitsRedeemed}, ${navPerUnit}, ${redemption.grossAmount}, ${input.notes}
    )
    RETURNING id
  `;
  const cashMovement = await db`
    INSERT INTO cash_movements (investor_id, nav_week_id, unit_ledger_id, date, type, amount, status, notes)
    VALUES (
      ${input.investorId}, ${navWeek.id}, ${unitLedger.rows[0].id}, ${input.date}, 'Withdrawal',
      ${netAmount}, 'settled', ${input.notes}
    )
    RETURNING id
  `;
  let performanceFeeId: string | null = null;
  if (feeAmount > 0) {
    // Credit the withheld fee to the brokerage pot, the same way a withdrawal
    // fee is credited, so the cash attribution sees where the money went.
    const fee = await db`
      INSERT INTO performance_fees (investor_id, nav_week_id, crystallized_gain, fee_rate_percent, fee_amount, date, notes)
      VALUES (
        ${input.investorId}, ${navWeek.id}, ${grossAmount},
        ${grossAmount > 0 ? roundMoney((feeAmount / grossAmount) * 100) : 0},
        ${feeAmount}, ${input.date}, ${input.notes}
      )
      RETURNING id
    `;
    performanceFeeId = fee.rows[0]?.id ?? null;
  }

  return {
    navWeekId: navWeek.id as string,
    navPerUnit,
    unitsRedeemed: redemption.unitsRedeemed,
    grossAmount: redemption.grossAmount,
    netAmount,
    feeAmount,
    unitLedgerId: unitLedger.rows[0].id as string,
    cashMovementId: cashMovement.rows[0].id as string,
    performanceFeeId,
  };
}

export async function recordCashMovement(input: CashMovementInput) {
  await requireAdmin();
  await ensureAuditColumns();
  assertNotFutureDate(input.date, "Movement date");

  const navWeek = await getLockedNavWeekForDate(input.date);
  if (!navWeek) {
    const anyLocked = await getLatestLockedNavWeek();
    if (!anyLocked) {
      return { error: "Cash movements require at least one locked NAV." };
    }
    return {
      error: `No locked NAV exists on or before ${input.date}. The earliest locked NAV is ${anyLocked.week_ending}. Create and lock a NAV dated on or before the movement, or use a later movement date.`,
    };
  }
  await assertNavIsSettlementGrade(navWeek.id, navWeek.week_ending);

  const navPerUnit = parseFloat(navWeek.nav_per_unit);
  let ledgerType = "UnitIssue";
  let units = 0;
  let grossAmount = roundMoney(input.amount);
  let brokerageFee = 0;
  let brokerageRate = 0;
  let realizedGain = 0;
  let performanceFeeId: string | null = null;

  if (input.type === "Deposit") {
    units = issueUnitsForDeposit({ amount: input.amount, navPerUnit });
  } else {
    ledgerType = "UnitRedemption";
    const equityPosition = await getEquityPositionAsOf(input.investorId, input.date);
    const availableUnits = roundUnits(equityPosition.units);
    if (input.withdrawAll) {
      if (availableUnits <= 0) throw new Error("No units available to redeem.");
      units = availableUnits;
      grossAmount = roundMoney(availableUnits * navPerUnit);
    } else {
      const redemption = redeemUnitsForWithdrawal({
        requestedAmount: input.amount,
        navPerUnit,
        availableUnits,
      });
      units = redemption.unitsRedeemed;
      grossAmount = redemption.grossAmount;
    }
    const redeemedBasis = roundMoney(availableUnits > 0 ? (equityPosition.investedCapital / availableUnits) * units : 0);
    realizedGain = roundMoney(Math.max(0, grossAmount - redeemedBasis));
    if (realizedGain > 0) {
      brokerageRate = await getBrokerageFeeRateValue();
      brokerageFee = roundMoney(realizedGain * (brokerageRate / 100));
    }
  }

  // The fee is withheld, not invoiced: the investor receives the redemption
  // value less the fee, and the fee stays in the fund as brokerage income.
  // cash_movements records the cash that actually moved, which is what the fund
  // cash reconciliation reads; the unit ledger keeps the gross unit valuation.
  const netAmount = roundMoney(grossAmount - brokerageFee);

  await withTransaction(async (db) => {
    if (brokerageFee > 0) {
      const fee = await db`
        INSERT INTO performance_fees (investor_id, nav_week_id, crystallized_gain, fee_rate_percent, fee_amount, date, notes)
        VALUES (
          ${input.investorId},
          ${navWeek.id},
          ${realizedGain},
          ${brokerageRate},
          ${brokerageFee},
          ${input.date},
          ${`Withdrawal brokerage fee on realized gain RM ${realizedGain.toFixed(2)}`}
        )
        RETURNING id
      `;
      performanceFeeId = fee.rows[0]?.id ?? null;
    }
    const unitLedger = await db`
      INSERT INTO investor_unit_ledger (investor_id, nav_week_id, date, type, units, nav_per_unit, gross_amount, notes)
      VALUES (
        ${input.investorId},
        ${navWeek.id},
        ${input.date},
        ${ledgerType},
        ${units},
        ${navPerUnit},
        ${grossAmount},
        ${input.type === "Withdrawal" && brokerageFee > 0
          ? `${input.notes || "Withdrawal"} | Fee RM ${brokerageFee.toFixed(2)} on realized gain RM ${realizedGain.toFixed(2)}`
          : input.notes || ""}
      )
      RETURNING id
    `;
    const cashMovement = await db`
      INSERT INTO cash_movements (investor_id, nav_week_id, unit_ledger_id, date, type, amount, status, notes)
      VALUES (
        ${input.investorId},
        ${navWeek.id},
        ${unitLedger.rows[0].id},
        ${input.date},
        ${input.type},
        ${netAmount},
        'settled',
        ${input.type === "Withdrawal" && brokerageFee > 0
          ? `${input.notes || "Withdrawal"} | Paid RM ${netAmount.toFixed(2)} after brokerage fee RM ${brokerageFee.toFixed(2)}`
          : input.notes || ""}
      )
      RETURNING id
    `;
    await writeAuditEvent("cash_movement.add", "cash_movements", cashMovement.rows[0].id, {
      type: input.type,
      amount: netAmount,
      grossAmount,
      units,
      brokerageFee,
      realizedGain,
      unitLedgerId: unitLedger.rows[0].id,
      performanceFeeId,
    }, db);
  });

  return { success: true };
}

export async function recordFixedSavings(input: FixedSavingsInput) {
  await requireAdmin();
  await ensureAuditColumns();
  assertNotFutureDate(input.date, "Fixed savings date");
  const ledgerIds: string[] = [];

  if (input.type === "Withdrawal") {
    const savingsRows = await sql`
      SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      WHERE investor_id = ${input.investorId}
        AND audit_status = 'active'
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `;
    const rateInput = await getFixedSavingsRateInputs();
    const savingsSummary = calculateFixedSavingsLiability(savingsRows.rows as FixedSavingsLedgerRow[], input.date, rateInput);
    if (input.amount > savingsSummary.totalLiability + 0.005) {
      throw new Error(`Withdrawal exceeds available fixed savings balance of RM ${savingsSummary.totalLiability.toFixed(2)}.`);
    }

    const ledger = await sql`
      INSERT INTO fixed_savings_ledger (account_id, investor_id, date, type, amount, notes, withdrawal_batch_id)
      VALUES (${null}, ${input.investorId}, ${input.date}, ${input.type}, ${input.amount}, ${input.notes || ""}, ${randomUUID()})
      RETURNING id
    `;
    ledgerIds.push(ledger.rows[0].id);
  } else {
    const ledger = await sql`
      INSERT INTO fixed_savings_ledger (account_id, investor_id, date, type, amount, notes)
      VALUES (${null}, ${input.investorId}, ${input.date}, ${input.type}, ${input.amount}, ${input.notes || ""})
      RETURNING id
    `;
    ledgerIds.push(ledger.rows[0].id);
  }

  await writeAuditEvent("fixed_savings.add", "fixed_savings_ledger", ledgerIds[0], {
    investorId: input.investorId,
    type: input.type,
    amount: input.amount,
    ledgerIds,
  });
  return { success: true };
}

export async function getCashMovements() {
  await requireAdmin();
  await ensureAuditColumns();
  const res = await sql`
    SELECT cm.*, i.name as investor_name, TO_CHAR(cm.date, 'YYYY-MM-DD') as date, nw.nav_per_unit
    FROM cash_movements cm
    JOIN investors i ON i.id = cm.investor_id
    LEFT JOIN nav_weeks nw ON nw.id = cm.nav_week_id
    WHERE cm.audit_status = 'active'
    ORDER BY cm.date DESC, cm.created_at DESC
  `;
  return res.rows;
}

export async function getFixedSavingsLedger() {
  await requireAdmin();
  await ensureAuditColumns();
  const res = await sql`
    SELECT fsl.*, i.name as investor_name, TO_CHAR(fsl.date, 'YYYY-MM-DD') as date
    FROM fixed_savings_ledger fsl
    JOIN investors i ON i.id = fsl.investor_id
    WHERE fsl.audit_status = 'active'
    ORDER BY fsl.date DESC, fsl.created_at DESC
  `;
  return fixedSavingsLedgerRows(res.rows);
}

export async function getInvestorsWithBalances() {
  await requireAdmin();
  await ensureAuditColumns();
  await ensureInvestorPortalAccessColumns();
  const [res, savings, equityLedger, rateInput] = await Promise.all([
    sql`
      WITH latest_nav AS (
        SELECT nav_per_unit
        FROM nav_weeks
        WHERE status = 'locked'
        ORDER BY week_ending DESC
        LIMIT 1
      ),
      fund_units AS (
        SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total_units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
      ),
      investor_units AS (
        SELECT investor_id,
          COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
        GROUP BY investor_id
      )
      SELECT i.id, i.name, i.portal_access_id, i.portal_access_rotated_at,
        TO_CHAR(i.created_at, 'YYYY-MM-DD') as joined,
        COALESCE(iu.units, 0) as units,
        COALESCE(fu.total_units, 0) as total_units,
        COALESCE((SELECT nav_per_unit FROM latest_nav), 1) as nav_per_unit
      FROM investors i
      CROSS JOIN fund_units fu
      LEFT JOIN investor_units iu ON iu.investor_id = i.id
      ORDER BY i.created_at DESC
    `,
    sql`
      SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      WHERE audit_status = 'active'
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `,
	    sql`
	      SELECT iul.investor_id, iul.type, iul.units, iul.gross_amount, TO_CHAR(iul.date, 'YYYY-MM-DD') as date,
	        CASE WHEN bp.id IS NULL THEN false ELSE true END as is_bonus
      FROM investor_unit_ledger iul
      LEFT JOIN bonus_payments bp ON bp.source_id = iul.id AND bp.ledger_type = 'equity'
	      WHERE iul.audit_status = 'active'
	      ORDER BY iul.date ASC, iul.created_at ASC
	    `,
	    getFixedSavingsRateInputs(),
	  ]);
  const savingsByInvestor = calculateFixedSavingsLiability(savings.rows as FixedSavingsLedgerRow[], todayIso(), rateInput).byInvestor;
  const equityRowsByInvestor = new Map<string, EquityUnitLedgerRow[]>();
  for (const row of equityLedger.rows as (EquityUnitLedgerRow & { investor_id: string })[]) {
    const rows = equityRowsByInvestor.get(row.investor_id) ?? [];
    rows.push(row);
    equityRowsByInvestor.set(row.investor_id, rows);
  }
  return res.rows.map((row: any) => {
    const units = roundUnits(parseFloat(row.units || "0"));
    const totalUnits = roundUnits(parseFloat(row.total_units || "0"));
    const navPerUnit = parseFloat(row.nav_per_unit || "1");
    const equityPosition = calculateEquityCapitalPosition(equityRowsByInvestor.get(row.id) ?? []);
    const marketValue = roundMoney(units * navPerUnit);
    const equityPerformance = calculateEquityPerformance(marketValue, equityPosition.investedCapital);
    const savingsSummary = savingsByInvestor.get(row.id) ?? {
      principal: 0,
      accruedInterest: 0,
      totalAccruedInterest: 0,
      bonusPayable: 0,
      payableInterest: 0,
      totalLiability: 0,
    };
    return {
      ...row,
      units,
      netInvestedCapital: equityPosition.investedCapital,
      marketValue,
      ...equityPerformance,
      ownershipPercent: calculateOwnershipPercent({ investorUnits: units, totalUnits }),
      fixedSavingsPrincipal: savingsSummary.principal,
      fixedSavingsAccruedInterest: savingsSummary.accruedInterest,
      fixedSavingsTotalAccruedInterest: savingsSummary.totalAccruedInterest,
      fixedSavingsInterest: savingsSummary.payableInterest,
      fixedSavingsBalance: savingsSummary.totalLiability,
    };
  });
}

export async function getInvestorStatement(investorId: string) {
  await ensureAuditColumns();
  const [summary, unitLedger, cash, savings, bonuses, fees, rateInput] = await Promise.all([
    sql`
      WITH latest_nav AS (
        SELECT id,
          TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending,
          TO_CHAR(settlement_date, 'YYYY-MM-DD') as settlement_date,
          gross_assets, fund_cash, equity_fund_cash, liabilities, adjustments, net_asset_value,
          total_units, nav_per_unit, status, locked_at, notes, created_at
        FROM nav_weeks
        WHERE status = 'locked'
        ORDER BY week_ending DESC
        LIMIT 1
      ),
      fund_units AS (
        SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total_units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
      ),
      investor_units AS (
        SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as units
        FROM investor_unit_ledger
        WHERE investor_id = ${investorId}
          AND audit_status = 'active'
      )
      SELECT i.id, i.name, TO_CHAR(i.created_at, 'YYYY-MM-DD') as joined,
        COALESCE(iu.units, 0) as units,
        COALESCE(fu.total_units, 0) as total_fund_units,
        COALESCE((SELECT nav_per_unit FROM latest_nav), 1) as nav_per_unit,
        (SELECT row_to_json(latest_nav) FROM latest_nav) as latest_nav
      FROM investors i
      CROSS JOIN fund_units fu
      CROSS JOIN investor_units iu
      WHERE i.id = ${investorId}
    `,
    sql`
      SELECT iul.*, TO_CHAR(iul.date, 'YYYY-MM-DD') as date,
        CASE WHEN bp.id IS NULL THEN false ELSE true END as is_bonus
      FROM investor_unit_ledger iul
      LEFT JOIN bonus_payments bp ON bp.source_id = iul.id AND bp.ledger_type = 'equity'
      WHERE iul.investor_id = ${investorId}
        AND iul.audit_status = 'active'
      ORDER BY iul.date DESC, iul.created_at DESC
    `,
    sql`
      SELECT *, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM cash_movements
      WHERE investor_id = ${investorId}
        AND audit_status = 'active'
      ORDER BY cash_movements.date DESC, cash_movements.created_at DESC
    `,
    sql`
      SELECT fsl.*,
        COALESCE(fsl.annual_rate_percent, fsl.interest_rate, fsa.annual_rate_percent) as effective_annual_rate_percent,
        TO_CHAR(fsl.date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger fsl
      LEFT JOIN fixed_savings_accounts fsa ON fsa.id = fsl.account_id
      WHERE fsl.investor_id = ${investorId}
        AND fsl.audit_status = 'active'
      ORDER BY fsl.date DESC, fsl.created_at DESC
    `,
    sql`
      SELECT bp.id, bp.ledger_type, bp.amount, TO_CHAR(bp.date, 'YYYY-MM-DD') as date, bp.notes, bp.created_at, bp.audit_status,
        iul.id as source_unit_id
      FROM bonus_payments bp
      LEFT JOIN investor_unit_ledger iul ON iul.id = bp.source_id
      WHERE bp.investor_id = ${investorId}
        AND bp.audit_status = 'active'
      ORDER BY bp.date DESC, bp.created_at DESC
    `,
    sql`
      SELECT id, crystallized_gain, fee_rate_percent, fee_amount, TO_CHAR(date, 'YYYY-MM-DD') as date, notes, created_at
      FROM performance_fees
      WHERE investor_id = ${investorId}
        AND audit_status <> 'reverted'
      ORDER BY performance_fees.date DESC, performance_fees.created_at DESC
    `,
    getFixedSavingsRateInputs(),
  ]);
  const row = summary.rows[0] ?? null;
  const investor = row ? { id: row.id, name: row.name, joined: row.joined } : null;
  if (!investor) return null;

  const savingsSummary = calculateFixedSavingsLiability(savings.rows as FixedSavingsLedgerRow[], todayIso(), rateInput);
  const units = roundUnits(parseFloat(row.units || "0"));
  const totalUnits = roundUnits(parseFloat(row.total_fund_units || "0"));
  const navPerUnit = parseFloat(row.nav_per_unit || "1");
  const marketValue = roundMoney(units * navPerUnit);
  const equityPosition = calculateEquityCapitalPosition(
    [...unitLedger.rows]
      .sort((a: any, b: any) => {
        const dateOrder = String(a.date).localeCompare(String(b.date));
        if (dateOrder !== 0) return dateOrder;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      }) as EquityUnitLedgerRow[],
  );
  const equityPerformance = calculateEquityPerformance(marketValue, equityPosition.investedCapital);
  const activityLedger = [
    ...unitLedger.rows.map((movement: any) => ({
      id: `unit-${movement.id}`,
      date: movement.date,
      category: "Equity Units",
      type: movement.is_bonus && movement.type === "UnitIssue" ? "BonusIssue" : movement.type,
      amount: parseFloat(movement.gross_amount || "0"),
      units: parseFloat(movement.units || "0"),
      navPerUnit: parseFloat(movement.nav_per_unit || "0"),
      notes: movement.notes,
      auditStatus: movement.audit_status,
      createdAt: movement.created_at,
    })),
    ...fixedSavingsActivityLedger(savings.rows),
    ...bonuses.rows
      .filter((bonus: any) => bonus.ledger_type !== "equity" || !bonus.source_unit_id)
      .map((bonus: any) => ({
        id: `bonus-${bonus.id}`,
        date: bonus.date,
        category: bonus.ledger_type === "equity" ? "Equity Bonus" : "Fixed Savings",
        type: bonus.ledger_type === "fixed_savings" ? "BonusAccrued" : "Bonus",
        amount: parseFloat(bonus.amount || "0"),
        units: null,
        navPerUnit: null,
        notes: bonus.notes,
        auditStatus: bonus.audit_status,
        createdAt: bonus.created_at,
      })),
    ...fees.rows.map((fee: any) => ({
      id: `fee-${fee.id}`,
      date: fee.date,
      category: "Brokerage Fee",
      type: "Fee",
      amount: -parseFloat(fee.fee_amount || "0"),
      units: null,
      navPerUnit: null,
      notes: fee.notes || `Realized gain RM ${Number(fee.crystallized_gain || 0).toFixed(2)} at ${Number(fee.fee_rate_percent || 0).toFixed(2)}%`,
      auditStatus: "active",
      createdAt: fee.created_at,
    })),
  ].sort((a: any, b: any) => {
    const dateOrder = String(b.date).localeCompare(String(a.date));
    if (dateOrder !== 0) return dateOrder;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  return {
    investor,
    latestNav: row.latest_nav,
    units,
    netInvestedCapital: equityPosition.investedCapital,
    marketValue,
    ...equityPerformance,
    ownershipPercent: calculateOwnershipPercent({ investorUnits: units, totalUnits }),
    unitLedger: unitLedger.rows,
    cashMovements: cash.rows,
    savingsLedger: savings.rows,
    bonusLedger: bonuses.rows,
    performanceFees: fees.rows,
    activityLedger,
    savingsPrincipal: savingsSummary.principal,
    savingsAccruedInterest: savingsSummary.accruedInterest,
    savingsTotalAccruedInterest: savingsSummary.totalAccruedInterest,
    savingsInterest: savingsSummary.payableInterest,
    savingsBalance: savingsSummary.totalLiability,
  };
}

export async function getInvestorStatementByPortalAccessId(portalAccessId: string, meta?: PortalAccessMeta) {
  await ensureInvestorPortalAccessColumns();
  const portalAccessHash = hashPortalAccessId(portalAccessId);
  await assertPortalAccessAllowed(portalAccessHash, meta);
  const result = await sql`
    SELECT id
    FROM investors
    WHERE portal_access_id = ${portalAccessId}
    LIMIT 1
  `;
  const investorId = result.rows[0]?.id;
  await writePortalAccessEvent({
    investorId: investorId ?? null,
    portalAccessHash,
    meta,
    outcome: investorId ? "success" : "not_found",
  });
  return investorId ? getInvestorStatement(investorId) : null;
}

/**
 * Statement plus dashboard data for one portal link.
 *
 * Exists so the dashboard route cannot reach the fund data without going through
 * the portal access check first - the check, the rate limit and the audit write
 * all live in getInvestorStatementByPortalAccessId.
 */
export async function getInvestorDashboardByPortalAccessId(portalAccessId: string, meta?: PortalAccessMeta) {
  const statement = await getInvestorStatementByPortalAccessId(portalAccessId, meta);
  if (!statement) return null;
  const dashboard = await getInvestorPortalDashboard(statement.investor.id);
  return { statement, ...dashboard };
}

/**
 * Fund and position data for the investor dashboard.
 *
 * Deliberately not admin-gated: the portal proves identity through
 * getInvestorStatementByPortalAccessId, which enforces the rate limit and writes
 * the access audit event. Call this only after that has succeeded.
 *
 * Platform allocation is returned as percentages and nothing else. Handing the
 * page RM values and merely hiding them would still ship them to the browser in
 * the server-component payload, where anyone with the portal link could read
 * them - so the values never leave this function.
 */
export async function getInvestorPortalDashboard(investorId: string) {
  await ensureAuditColumns();
  const [weeks, unitLedger, allocation] = await Promise.all([
    sql`
      SELECT id, TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending, nav_per_unit
      FROM nav_weeks
      WHERE status = 'locked'
      ORDER BY week_ending ASC
    `,
    sql`
      SELECT iul.id, iul.type, iul.units, iul.gross_amount, iul.created_at,
        TO_CHAR(iul.date, 'YYYY-MM-DD') as date,
        CASE WHEN bp.id IS NULL THEN false ELSE true END as is_bonus
      FROM investor_unit_ledger iul
      LEFT JOIN bonus_payments bp ON bp.source_id = iul.id AND bp.ledger_type = 'equity'
      WHERE iul.investor_id = ${investorId}
        AND iul.audit_status = 'active'
      ORDER BY iul.date ASC, iul.created_at ASC
    `,
    sql`
      WITH latest_nav AS (
        SELECT id FROM nav_weeks WHERE status = 'locked' ORDER BY week_ending DESC LIMIT 1
      )
      SELECT p.name, nwps.total_value
      FROM nav_week_platform_snapshots nwps
      JOIN platforms p ON p.id = nwps.platform_id
      WHERE nwps.nav_week_id = (SELECT id FROM latest_nav)
        AND nwps.total_value > 0
      ORDER BY nwps.total_value DESC
    `,
  ]);

  const rows = unitLedger.rows as EquityUnitLedgerRow[];
  // Replayed through the same function the statement uses, so a point on this
  // chart and the headline figure can never disagree about cost basis.
  const valueHistory = weeks.rows.map((week: Record<string, unknown>) => {
    const weekEnding = String(week.week_ending);
    const navPerUnit = parseFloat(String(week.nav_per_unit || "1"));
    const position = calculateEquityCapitalPosition(
      rows.filter((row) => String(row.date) <= weekEnding),
    );
    return {
      weekEnding,
      navPerUnit,
      marketValue: roundMoney(position.units * navPerUnit),
      netInvested: position.investedCapital,
    };
  // Weeks before the investor joined would draw a flat zero run-in that reads
  // as a loss of value rather than an absence of one.
  }).filter((point) => point.marketValue > 0 || point.netInvested > 0);

  const percentages = allocateSharePercentages(
    allocation.rows.map((row: Record<string, unknown>) => parseFloat(String(row.total_value || "0"))),
  );
  const platformAllocation = allocation.rows.map((row: Record<string, unknown>, index: number) => ({
    name: String(row.name),
    percent: percentages[index],
  }));

  // The fund's own price series, not clipped to this investor's tenure - the
  // card presents it as the fund's whole history, so it has to be that.
  const navHistory = weeks.rows.map((week: Record<string, unknown>) => ({
    weekEnding: String(week.week_ending),
    navPerUnit: parseFloat(String(week.nav_per_unit || "1")),
  }));

  return { valueHistory, navHistory, platformAllocation };
}

export async function getFundSummaryMetrics() {
  await requireAdmin();
  await ensureAuditColumns();
  const [summary, savings, rateInput] = await Promise.all([
    sql`
      WITH latest_nav AS (
        SELECT id,
          TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending,
          TO_CHAR(settlement_date, 'YYYY-MM-DD') as settlement_date,
          gross_assets, fund_cash, equity_fund_cash, liabilities, adjustments, net_asset_value,
          total_units, nav_per_unit, status, locked_at, notes, created_at
        FROM nav_weeks
        WHERE status = 'locked'
        ORDER BY week_ending DESC
        LIMIT 1
      ),
      fund_units AS (
        SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total_units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
      ),
      fees AS (
        SELECT COALESCE(SUM(fee_amount), 0) as total
        FROM performance_fees
        WHERE audit_status <> 'reverted'
      )
      SELECT
        (SELECT row_to_json(latest_nav) FROM latest_nav) as latest_nav,
        (SELECT total_units FROM fund_units) as total_units,
        (SELECT total FROM fees) as performance_fees,
        COALESCE((
          SELECT SUM(nwps.brokerage_profit_loss)
          FROM nav_week_platform_snapshots nwps
          WHERE nwps.nav_week_id = (SELECT id FROM latest_nav)
        ), 0) as brokerage_profit_loss
    `,
    sql`
      SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      WHERE audit_status = 'active'
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `,
    getFixedSavingsRateInputs(),
  ]);
  const row = summary.rows[0] ?? {};
  const latestNav = row.latest_nav ?? null;
  const fixedSavings = calculateFixedSavingsLiability(savings.rows as FixedSavingsLedgerRow[], todayIso(), rateInput);
  const totalUnits = roundUnits(parseFloat(row.total_units || "0"));
  const currentEquityNav = calculateCurrentEquityNav(latestNav, totalUnits);

  return {
    latestNav,
    totalUnits,
    fixedSavingsLiability: fixedSavings.totalLiability,
    fixedSavingsPrincipal: fixedSavings.principal,
    fixedSavingsInterest: fixedSavings.payableInterest,
    totalInvestorCapital: roundMoney(currentEquityNav + fixedSavings.totalLiability),
    brokerageProfitLoss: roundMoney(parseFloat(row.brokerage_profit_loss || "0")),
    performanceFees: roundMoney(parseFloat(row.performance_fees || "0")),
    aum: currentEquityNav,
  };
}

export async function getDashboardSummary() {
  await requireAdmin();
  await ensureAuditColumns();
  await ensureInvestorPortalAccessColumns();
  const [summaryResult, savings, investorsResult, equityLedger, rateInput] = await Promise.all([
    sql`
      WITH latest_nav AS (
        SELECT id,
          TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending,
          TO_CHAR(settlement_date, 'YYYY-MM-DD') as settlement_date,
          gross_assets, fund_cash, equity_fund_cash, liabilities, adjustments, net_asset_value,
          total_units, nav_per_unit, status, locked_at, notes, created_at
        FROM nav_weeks
        WHERE status = 'locked'
        ORDER BY week_ending DESC
        LIMIT 1
      ),
      fund_units AS (
        SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total_units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
      ),
      fees AS (
        SELECT COALESCE(SUM(fee_amount), 0) as total
        FROM performance_fees
        WHERE audit_status <> 'reverted'
      )
      SELECT
        (SELECT row_to_json(latest_nav) FROM latest_nav) as latest_nav,
        (SELECT total_units FROM fund_units) as total_units,
        (SELECT total FROM fees) as performance_fees,
        COALESCE((
          SELECT SUM(nwps.brokerage_profit_loss)
          FROM nav_week_platform_snapshots nwps
          WHERE nwps.nav_week_id = (SELECT id FROM latest_nav)
        ), 0) as brokerage_profit_loss
    `,
    sql`
      SELECT id, account_id, investor_id, withdrawal_batch_id, type, amount, annual_rate_percent, interest_rate, audit_status, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      WHERE audit_status = 'active'
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `,
    sql`
      WITH fund_units AS (
        SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total_units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
      ),
      investor_units AS (
        SELECT investor_id,
          COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
        GROUP BY investor_id
      )
      SELECT i.id, i.name, i.portal_access_id, i.portal_access_rotated_at,
        TO_CHAR(i.created_at, 'YYYY-MM-DD') as joined,
        COALESCE(iu.units, 0) as units,
        COALESCE(fu.total_units, 0) as total_units
      FROM investors i
      CROSS JOIN fund_units fu
      LEFT JOIN investor_units iu ON iu.investor_id = i.id
      ORDER BY i.created_at DESC
    `,
    sql`
      SELECT iul.investor_id, iul.type, iul.units, iul.gross_amount, TO_CHAR(iul.date, 'YYYY-MM-DD') as date,
        CASE WHEN bp.id IS NULL THEN false ELSE true END as is_bonus
      FROM investor_unit_ledger iul
      LEFT JOIN bonus_payments bp ON bp.source_id = iul.id AND bp.ledger_type = 'equity'
      WHERE iul.audit_status = 'active'
      ORDER BY iul.date ASC, iul.created_at ASC
    `,
    getFixedSavingsRateInputs(),
  ]);
  const summaryRow = summaryResult.rows[0] ?? {};
  const latestNav = summaryRow.latest_nav ?? null;
  const fixedSavings = calculateFixedSavingsLiability(savings.rows as FixedSavingsLedgerRow[], todayIso(), rateInput);
  const savingsByInvestor = fixedSavings.byInvestor;
  const totalUnits = roundUnits(parseFloat(summaryRow.total_units || "0"));
  const navPerUnit = latestNav ? parseFloat(latestNav.nav_per_unit || "1") : 1;
  const currentEquityNav = calculateCurrentEquityNav(latestNav, totalUnits);
  const equityRowsByInvestor = new Map<string, EquityUnitLedgerRow[]>();
  for (const row of equityLedger.rows as (EquityUnitLedgerRow & { investor_id: string })[]) {
    const rows = equityRowsByInvestor.get(row.investor_id) ?? [];
    rows.push(row);
    equityRowsByInvestor.set(row.investor_id, rows);
  }
  const investors = investorsResult.rows.map((row: any) => {
    const units = roundUnits(parseFloat(row.units || "0"));
    const equityPosition = calculateEquityCapitalPosition(equityRowsByInvestor.get(row.id) ?? []);
    const marketValue = roundMoney(units * navPerUnit);
    const equityPerformance = calculateEquityPerformance(marketValue, equityPosition.investedCapital);
    const savingsSummary = savingsByInvestor.get(row.id) ?? {
      principal: 0,
      accruedInterest: 0,
      totalAccruedInterest: 0,
      bonusPayable: 0,
      payableInterest: 0,
      totalLiability: 0,
    };
    return {
      ...row,
      units,
      total_units: totalUnits,
      nav_per_unit: navPerUnit,
      netInvestedCapital: equityPosition.investedCapital,
      marketValue,
      ...equityPerformance,
      ownershipPercent: calculateOwnershipPercent({ investorUnits: units, totalUnits }),
      fixedSavingsPrincipal: savingsSummary.principal,
      fixedSavingsAccruedInterest: savingsSummary.accruedInterest,
      fixedSavingsTotalAccruedInterest: savingsSummary.totalAccruedInterest,
      fixedSavingsInterest: savingsSummary.payableInterest,
      fixedSavingsBalance: savingsSummary.totalLiability,
    };
  });
  const totalEquityInvestedCapital = roundMoney(
    investors.reduce((sum: number, investor: any) => sum + investor.netInvestedCapital, 0),
  );
  const equityPerformance = calculateEquityPerformance(currentEquityNav, totalEquityInvestedCapital);
  return {
    latestNav,
    totalUnits,
    fixedSavingsLiability: fixedSavings.totalLiability,
    fixedSavingsPrincipal: fixedSavings.principal,
    fixedSavingsInterest: fixedSavings.payableInterest,
    // payableInterest fuses the two together. The dashboard names them apart so
    // the principal headline can be reconciled to the full liability.
    fixedSavingsAccruedInterest: fixedSavings.accruedInterest,
    fixedSavingsBonus: fixedSavings.bonusPayable,
    totalEquityInvestedCapital,
    ...equityPerformance,
    totalInvestorCapital: roundMoney(currentEquityNav + fixedSavings.totalLiability),
    brokerageProfitLoss: roundMoney(parseFloat(summaryRow.brokerage_profit_loss || "0")),
    performanceFees: roundMoney(parseFloat(summaryRow.performance_fees || "0")),
    aum: currentEquityNav,
    investors,
    cash: [],
  };
}

export async function cleanAllData() {
  await ensureFreshFundSchema();
  const tables = await existingResettableTables();
  if (tables.length > 0) {
    await sql.query(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  }
  await resetFundConfigDefaults();
  await writeAuditEvent("development.clean_all_data", "database", null, {
    tables,
    brokerageFeePercent: DEFAULT_BROKERAGE_FEE_RATE,
  });
}

export async function dropAllFundTables() {
  auditColumnsPromise = null;
  investorPortalAccessColumnsPromise = null;
  fixedSavingsRateTablesPromise = null;
  const tables = await existingResettableTables();
  if (tables.length > 0) {
    await sql.query(`DROP TABLE ${tables.join(", ")} CASCADE`);
  }
}

export async function seedDummyData() {
  await dropAllFundTables();
  await initializeFreshFundDatabase();

  const alice = await sql`
    INSERT INTO investors (name, portal_access_id, portal_access_rotated_at)
    VALUES ('Alice Tan', 'demo-alice-tan-2026', NOW())
    RETURNING id
  `;
  const ben = await sql`
    INSERT INTO investors (name, portal_access_id, portal_access_rotated_at)
    VALUES ('Ben Lim', 'demo-ben-lim-2026', NOW())
    RETURNING id
  `;
  const chandra = await sql`
    INSERT INTO investors (name, portal_access_id, portal_access_rotated_at)
    VALUES ('Chandra Kumar', 'demo-chandra-kumar-2026', NOW())
    RETURNING id
  `;
  const farah = await sql`
    INSERT INTO investors (name, portal_access_id, portal_access_rotated_at)
    VALUES ('Farah Rahman', 'demo-farah-rahman-2026', NOW())
    RETURNING id
  `;
  const grace = await sql`
    INSERT INTO investors (name, portal_access_id, portal_access_rotated_at)
    VALUES ('Grace Wong', 'demo-grace-wong-2026', NOW())
    RETURNING id
  `;

  await sql`
    UPDATE fund_config
    SET value = '2.0', updated_at = NOW()
    WHERE key = 'brokerage_fee_pct'
  `;
  await sql`
    INSERT INTO fixed_savings_base_rates (effective_date, annual_rate_percent)
    VALUES
      ('2026-03-01', 4.0000),
      ('2026-04-01', 4.2500),
      ('2026-07-01', 4.1000)
    ON CONFLICT (effective_date) DO UPDATE
    SET annual_rate_percent = EXCLUDED.annual_rate_percent
  `;
  await sql`
    INSERT INTO fixed_savings_promotions (name, start_date, end_date, annual_rate_percent, balance_cap, status, notes)
    VALUES
      ('Seed 5% Launch Promo', '2026-03-15', '2026-06-14', 5.0000, 50000, 'active', 'Demo capped launch promotion for fixed savings balances.'),
      ('Seed Expired 4.8% Promo', '2026-01-01', '2026-02-28', 4.8000, NULL, 'disabled', 'Disabled historical promotion for rate-settings workflow coverage.')
  `;

  const ibkr = await sql`
    INSERT INTO platforms (name, base_currency, default_currency)
    VALUES ('Interactive Brokers', 'MYR', 'USD')
    RETURNING id
  `;
  const moomoo = await sql`
    INSERT INTO platforms (name, base_currency, default_currency)
    VALUES ('Moomoo Malaysia', 'MYR', 'MYR')
    RETURNING id
  `;
  const binance = await sql`
    INSERT INTO platforms (name, base_currency, default_currency)
    VALUES ('Binance Custody', 'MYR', 'USDT')
    RETURNING id
  `;
  const maybank = await sql`
    INSERT INTO platforms (name, base_currency, default_currency)
    VALUES ('Maybank Cash Reserve', 'MYR', 'MYR')
    RETURNING id
  `;

  const ibkrMargin = await sql`
    INSERT INTO platform_accounts (platform_id, name, account_type, currency)
    VALUES (${ibkr.rows[0].id}, 'Margin Portfolio', 'BROKER_PORTFOLIO', 'USD')
    RETURNING id
  `;
  const ibkrCash = await sql`
    INSERT INTO platform_accounts (platform_id, name, account_type, currency)
    VALUES (${ibkr.rows[0].id}, 'USD Cash', 'BROKER_CASH', 'USD')
    RETURNING id
  `;
  const moomooCash = await sql`
    INSERT INTO platform_accounts (platform_id, name, account_type, currency)
    VALUES (${moomoo.rows[0].id}, 'MYR Trading Cash', 'BROKER_CASH', 'MYR')
    RETURNING id
  `;
  const binanceSpot = await sql`
    INSERT INTO platform_accounts (platform_id, name, account_type, currency)
    VALUES (${binance.rows[0].id}, 'Spot Wallet', 'WALLET', 'USDT')
    RETURNING id
  `;
  const reserveCash = await sql`
    INSERT INTO platform_accounts (platform_id, name, account_type, currency)
    VALUES (${maybank.rows[0].id}, 'Operating Reserve', 'BANK', 'MYR')
    RETURNING id
  `;

  const aapl = await sql`
    INSERT INTO platform_assets (platform_id, symbol, name, asset_type, currency, latest_price, latest_fx_rate_to_myr)
    VALUES (${ibkr.rows[0].id}, 'AAPL', 'Apple Inc.', 'EQUITY', 'USD', 198.12000000, 4.72000000)
    RETURNING id
  `;
  const voo = await sql`
    INSERT INTO platform_assets (platform_id, symbol, name, asset_type, currency, latest_price, latest_fx_rate_to_myr)
    VALUES (${ibkr.rows[0].id}, 'VOO', 'Vanguard S&P 500 ETF', 'ETF', 'USD', 518.44000000, 4.72000000)
    RETURNING id
  `;
  const maybankStock = await sql`
    INSERT INTO platform_assets (platform_id, symbol, name, asset_type, currency, latest_price, latest_fx_rate_to_myr)
    VALUES (${moomoo.rows[0].id}, 'MAYBANK', 'Malayan Banking Berhad', 'EQUITY', 'MYR', 10.12000000, 1.00000000)
    RETURNING id
  `;
  const btc = await sql`
    INSERT INTO platform_assets (platform_id, symbol, name, asset_type, currency, latest_price, latest_fx_rate_to_myr)
    VALUES (${binance.rows[0].id}, 'BTC', 'Bitcoin', 'CRYPTO', 'USDT', 104250.00000000, 4.71000000)
    RETURNING id
  `;

  async function insertPlatformTransaction(input: SeedPlatformTransactionInput) {
    const currency = input.currency || "MYR";
    const baseAmount = input.baseAmount ?? input.amount;
    const fxRateToBase = input.fxRateToBase ?? 1;
    const inserted = await sql`
      INSERT INTO platform_transactions (
        platform_id, account_id, asset_id, funding_source, date, type, amount, currency, base_currency, base_amount,
        fx_rate_to_base, quantity, price_per_unit, gross_amount, fee_amount, tax_amount, net_amount,
        realized_profit, reference, status, settlement_date, notes, allocation_method
      )
      VALUES (
        ${input.platformId}, ${input.accountId || null}, ${input.assetId || null}, ${input.allocations?.[0]?.fundingSource || "equity"},
        ${input.date}, ${input.type}, ${input.amount}, ${currency}, 'MYR', ${baseAmount}, ${fxRateToBase},
        ${input.quantity ?? null}, ${input.pricePerUnit ?? null}, ${input.grossAmount ?? null},
        ${input.feeAmount ?? 0}, ${input.taxAmount ?? 0}, ${input.netAmount ?? null}, ${input.realizedProfit ?? null},
        ${input.reference}, 'SETTLED', ${input.settlementDate || input.date}, ${input.notes},
        ${input.allocations?.length ? "manual" : "none"}
      )
      RETURNING id
    `;
    for (const allocation of input.allocations || []) {
      await sql`
        INSERT INTO platform_transaction_allocations (transaction_id, funding_source, ratio_percent, base_amount)
        VALUES (${inserted.rows[0].id}, ${allocation.fundingSource}, ${allocation.ratioPercent}, ${allocation.baseAmount})
      `;
    }
    return inserted.rows[0].id as string;
  }

  async function lockSeedNavWeek(weekEnding: string) {
    const week = await sql`SELECT id FROM nav_weeks WHERE week_ending = ${weekEnding}`;
    await lockNavWeek(week.rows[0].id);
  }

  function utcDate(value: string) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function isoDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  function addDays(value: Date, days: number) {
    const next = new Date(value);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  const seedFixedSavingsBalances = new Map<string, number>();

  async function seedWeeklyDemoHistory(start: string, end: string, startIndex: number) {
    const investors = [
      { id: alice.rows[0].id, name: "Alice" },
      { id: ben.rows[0].id, name: "Ben" },
      { id: chandra.rows[0].id, name: "Chandra" },
      { id: farah.rows[0].id, name: "Farah" },
      { id: grace.rows[0].id, name: "Grace" },
    ];
    const platforms = [
      { id: ibkr.rows[0].id, accountId: ibkrCash.rows[0].id, assetId: voo.rows[0].id, name: "IBKR", currency: "USD", fx: 4.68 },
      { id: moomoo.rows[0].id, accountId: moomooCash.rows[0].id, assetId: maybankStock.rows[0].id, name: "Moomoo", currency: "MYR", fx: 1 },
      { id: binance.rows[0].id, accountId: binanceSpot.rows[0].id, assetId: btc.rows[0].id, name: "Binance", currency: "USDT", fx: 4.7 },
      { id: maybank.rows[0].id, accountId: reserveCash.rows[0].id, assetId: null, name: "Reserve", currency: "MYR", fx: 1 },
    ];
    let index = startIndex;

    for (let date = utcDate(start); date <= utcDate(end); date = addDays(date, 7)) {
      const weekEnding = isoDate(date);
      const eventDate = isoDate(addDays(date, -2));
      const investor = investors[index % investors.length];
      const platform = platforms[index % platforms.length];
      // Sized against the capital the seed actually raises - about RM 1.03m
      // across equity and savings - rather than against nothing. The previous
      // figures deployed roughly 1.5x what came in, which only looked coherent
      // while a third of it was labelled brokerage-funded and therefore did not
      // count against either real pool.
      const baseFlow = 2350 + ((index * 1375) % 9600);

      if (index % 4 === 0) {
        await recordCashMovement({
          investorId: investor.id,
          date: eventDate,
          type: "Deposit",
          amount: 5000 + ((index * 925) % 16000),
          notes: `Seed recurring equity subscription ${index + 1}`,
        });
      }
      if (index > 12 && index % 17 === 0) {
        await recordCashMovement({
          investorId: investors[(index + 1) % investors.length].id,
          date: eventDate,
          type: "Withdrawal",
          amount: 1800 + ((index * 350) % 4200),
          notes: `Seed partial equity redemption ${index + 1}`,
        });
      }
      if (index % 8 === 0) {
        const savingsInvestor = investors[(index + 2) % investors.length];
        const savingsAmount = 3000 + ((index * 575) % 11000);
        await recordFixedSavings({
          investorId: savingsInvestor.id,
          date: eventDate,
          type: "Deposit",
          amount: savingsAmount,
          notes: `Seed fixed savings placement ${index + 1}`,
        });
        seedFixedSavingsBalances.set(savingsInvestor.id, (seedFixedSavingsBalances.get(savingsInvestor.id) ?? 0) + savingsAmount);
      }
      if (index > 16 && index % 23 === 0) {
        const savingsInvestor = investors.find((candidate) => (seedFixedSavingsBalances.get(candidate.id) ?? 0) > 5000);
        if (savingsInvestor) {
          const savingsAmount = Math.min(1200 + ((index * 225) % 2800), (seedFixedSavingsBalances.get(savingsInvestor.id) ?? 0) - 1000);
          await recordFixedSavings({
            investorId: savingsInvestor.id,
            date: eventDate,
            type: "Withdrawal",
            amount: savingsAmount,
            notes: `Seed fixed savings withdrawal ${index + 1}`,
          });
          seedFixedSavingsBalances.set(savingsInvestor.id, (seedFixedSavingsBalances.get(savingsInvestor.id) ?? 0) - savingsAmount);
        }
      }

      await insertPlatformTransaction({
        platformId: platform.id,
        accountId: platform.accountId,
        date: eventDate,
        type: index % 11 === 0 ? "BROKER_WITHDRAWAL" : "BROKER_DEPOSIT",
        amount: platform.fx === 1 ? baseFlow : roundMoney(baseFlow / platform.fx),
        currency: platform.currency,
        baseAmount: baseFlow,
        fxRateToBase: platform.fx,
        reference: `SEED-${platform.name.toUpperCase()}-FLOW-${String(index + 1).padStart(3, "0")}`,
        notes: `Seed ${platform.name} funding flow ${index + 1}`,
        // 75/25 tracks the real pool sizes - roughly RM 797k of equity against
        // RM 249k of savings - so both pools end up similarly deployed with
        // headroom left. A larger savings share would deploy savers beyond what
        // they placed, which is the same inversion brokerage funding produced.
        allocations: index % 11 === 0
          ? [{ fundingSource: "equity", ratioPercent: 100, baseAmount: -baseFlow }]
          : [
              { fundingSource: "equity", ratioPercent: 75, baseAmount: roundMoney(baseFlow * 0.75) },
              { fundingSource: "fixed_savings", ratioPercent: 25, baseAmount: roundMoney(baseFlow * 0.25) },
            ],
      });

      if (platform.assetId) {
        const tradeBaseAmount = 1800 + ((index * 741) % 14500);
        const isSell = index > 10 && index % 5 === 0;
        await insertPlatformTransaction({
          platformId: platform.id,
          accountId: platform.accountId,
          assetId: platform.assetId,
          date: isoDate(addDays(date, -1)),
          type: isSell ? "SELL" : "BUY",
          amount: platform.fx === 1 ? tradeBaseAmount : roundMoney(tradeBaseAmount / platform.fx),
          currency: platform.currency,
          baseAmount: tradeBaseAmount,
          fxRateToBase: platform.fx,
          quantity: platform.name === "Binance" ? Number((0.005 + (index % 9) * 0.0017).toFixed(8)) : 10 + (index % 70),
          pricePerUnit: platform.name === "Binance" ? 68000 + index * 275 : 8 + (index % 40) * 3.7,
          grossAmount: tradeBaseAmount,
          feeAmount: roundMoney(tradeBaseAmount * 0.0015),
          netAmount: tradeBaseAmount,
          realizedProfit: isSell ? roundMoney(250 + ((index * 113) % 3900) - (index % 2 === 0 ? 0 : 600)) : null,
          reference: `SEED-${platform.name.toUpperCase()}-TRADE-${String(index + 1).padStart(3, "0")}`,
          notes: `Seed ${isSell ? "sell" : "buy"} trade ${index + 1}`,
        });
      }

      // The seed moves real money: subscriptions, redemptions, savings
      // placements and trades. Leaving the bank balance unrecorded makes the
      // book claim the fund holds nothing, so savers' undeployed cash shows up
      // as negative equity instead of cash held on their behalf.
      //
      // Trade sizing here is formula-driven rather than cash-constrained, so a
      // few weeks deploy marginally more than subscriptions brought in. A bank
      // account cannot hold less than nothing - recordFundCash rejects a
      // negative balance - so those weeks show an empty account.
      const expectedCash = (await getFundCashAsOf(weekEnding)).expectedBalance;

      await createNavWeek({
        weekEnding,
        settlementDate: weekEnding,
        fundCash: roundMoney(Math.max(expectedCash, 0)),
        // The seed stands in for an admin who reconciled the bank every week.
        // Without this the balance is never anchored and savers' undeployed
        // cash reads as negative equity, which is what the note above warns of.
        fundCashConfirmed: true,
        // Demo data has to contain losses or it teaches nothing: with every
        // platform up, there is no way to see whether attribution, NAV or the
        // return columns actually handle a loss.
        //
        // The swing amplitude grows with the index rather than staying fixed, so
        // it keeps outrunning the drift and the sine keeps crossing zero. The
        // previous form - a fixed amplitude plus a linear drift - went
        // permanently positive as soon as the drift overtook it, which is why
        // every late week showed a gain.
        //
        // Binance is the structural loser: its drift is negative throughout, at
        // a small enough slope that the loss stays far inside the platform's net
        // invested and total value never approaches zero.
        //
        // The winners' drift and amplitude are sized against the deployed book,
        // not left at fixed figures. They used to be small enough that NAV per
        // unit never cleared 1.01 once equity stopped being credited with profit
        // on capital it had not raised, which showed neither gains nor fees.
        platformSnapshots: [
          { platformId: ibkr.rows[0].id, unrealizedProfit: roundMoney(Math.sin(index / 4) * (3000 + index * 2400) + index * 1800) },
          { platformId: moomoo.rows[0].id, unrealizedProfit: roundMoney(Math.cos(index / 5) * (2000 + index * 1800) + index * 1100) },
          { platformId: binance.rows[0].id, unrealizedProfit: roundMoney(Math.sin(index / 3) * (1500 + index * 70) - index * 400) },
          { platformId: maybank.rows[0].id, unrealizedProfit: roundMoney(Math.cos(index / 6) * (350 + index * 180) + index * 150) },
        ],
        // Was always positive, which handed the fund a free gain every single
        // week on top of the platform marks. Centred on zero now so it cuts both
        // ways.
        adjustments: ((index * 425) % 22000) - 11000,
        notes: `Seed locked weekly NAV ${weekEnding}`,
      });
      await lockSeedNavWeek(weekEnding);
      index += 1;
    }

    return index;
  }

  await createNavWeek({
    weekEnding: "2024-01-05",
    settlementDate: "2024-01-05",
    platformSnapshots: [
      { platformId: ibkr.rows[0].id, unrealizedProfit: 0 },
      { platformId: moomoo.rows[0].id, unrealizedProfit: 0 },
      { platformId: binance.rows[0].id, unrealizedProfit: 0 },
      { platformId: maybank.rows[0].id, unrealizedProfit: 0 },
    ],
    adjustments: 10000,
    notes: "Seed opening NAV for 2024 dummy history",
  });
  await lockSeedNavWeek("2024-01-05");
  await recordCashMovement({ investorId: alice.rows[0].id, date: "2024-01-08", type: "Deposit", amount: 50000, notes: "Seed 2024 opening equity subscription" });
  await recordCashMovement({ investorId: ben.rows[0].id, date: "2024-01-08", type: "Deposit", amount: 45000, notes: "Seed 2024 opening equity subscription" });
  await recordCashMovement({ investorId: chandra.rows[0].id, date: "2024-01-09", type: "Deposit", amount: 35000, notes: "Seed 2024 opening equity subscription" });
  await recordCashMovement({ investorId: farah.rows[0].id, date: "2024-01-09", type: "Deposit", amount: 25000, notes: "Seed 2024 opening equity subscription" });
  await recordCashMovement({ investorId: grace.rows[0].id, date: "2024-01-10", type: "Deposit", amount: 30000, notes: "Seed 2024 opening equity subscription" });
  await recordFixedSavings({ investorId: alice.rows[0].id, date: "2024-01-10", type: "Deposit", amount: 12000, notes: "Seed 2024 opening fixed savings placement" });
  await recordFixedSavings({ investorId: farah.rows[0].id, date: "2024-01-10", type: "Deposit", amount: 18000, notes: "Seed 2024 opening fixed savings placement" });
  seedFixedSavingsBalances.set(alice.rows[0].id, 12000);
  seedFixedSavingsBalances.set(farah.rows[0].id, 18000);
  const nextSeedIndex = await seedWeeklyDemoHistory("2024-01-12", "2026-02-27", 1);

  await createNavWeek({
    weekEnding: "2026-03-06",
    settlementDate: "2026-03-06",
    platformSnapshots: [
      { platformId: ibkr.rows[0].id, unrealizedProfit: 0 },
      { platformId: moomoo.rows[0].id, unrealizedProfit: 0 },
      { platformId: binance.rows[0].id, unrealizedProfit: 0 },
      { platformId: maybank.rows[0].id, unrealizedProfit: 0 },
    ],
    adjustments: 10000,
    notes: "Bootstrap NAV before investor subscriptions",
  });
  const week1 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-03-06'`;
  await lockNavWeek(week1.rows[0].id);

  await recordCashMovement({ investorId: alice.rows[0].id, date: "2026-03-09", type: "Deposit", amount: 75000, notes: "Initial equity subscription" });
  await recordCashMovement({ investorId: ben.rows[0].id, date: "2026-03-09", type: "Deposit", amount: 52000, notes: "Initial equity subscription" });
  await recordCashMovement({ investorId: chandra.rows[0].id, date: "2026-03-10", type: "Deposit", amount: 38000, notes: "Initial equity subscription" });
  await recordFixedSavings({ investorId: alice.rows[0].id, date: "2026-03-11", type: "Deposit", amount: 18000, notes: "Twelve-month fixed savings placement" });
  await recordFixedSavings({ investorId: farah.rows[0].id, date: "2026-03-11", type: "Deposit", amount: 42000, notes: "Fixed savings-only mandate" });

  await insertPlatformTransaction({
    platformId: ibkr.rows[0].id,
    accountId: ibkrCash.rows[0].id,
    date: "2026-03-12",
    type: "BROKER_DEPOSIT",
    amount: 85000,
    baseAmount: 85000,
    reference: "SEED-IBKR-FUNDING-001",
    notes: "Initial IBKR funding from equity pool",
    allocations: [{ fundingSource: "equity", ratioPercent: 100, baseAmount: 85000 }],
  });
  await insertPlatformTransaction({
    platformId: moomoo.rows[0].id,
    accountId: moomooCash.rows[0].id,
    date: "2026-03-12",
    type: "BROKER_DEPOSIT",
    amount: 45000,
    baseAmount: 45000,
    reference: "SEED-MOOMOO-FUNDING-001",
    notes: "MYR brokerage funding from equity pool",
    allocations: [{ fundingSource: "equity", ratioPercent: 100, baseAmount: 45000 }],
  });
  await insertPlatformTransaction({
    platformId: maybank.rows[0].id,
    accountId: reserveCash.rows[0].id,
    date: "2026-03-12",
    type: "BROKER_DEPOSIT",
    amount: 25000,
    baseAmount: 25000,
    reference: "SEED-RESERVE-FUNDING-001",
    notes: "Operating cash reserve",
    allocations: [{ fundingSource: "equity", ratioPercent: 100, baseAmount: 25000 }],
  });
  await insertPlatformTransaction({
    platformId: ibkr.rows[0].id,
    accountId: ibkrMargin.rows[0].id,
    assetId: voo.rows[0].id,
    date: "2026-03-13",
    type: "BUY",
    amount: 33019.2,
    currency: "USD",
    baseAmount: 155850,
    fxRateToBase: 4.72,
    quantity: 64,
    pricePerUnit: 515.3,
    grossAmount: 155745.4,
    feeAmount: 104.6,
    netAmount: 155850,
    reference: "SEED-IBKR-VOO-BUY-001",
    notes: "Core ETF allocation",
  });
  await insertPlatformTransaction({
    platformId: moomoo.rows[0].id,
    accountId: moomooCash.rows[0].id,
    assetId: maybankStock.rows[0].id,
    date: "2026-03-13",
    type: "BUY",
    amount: 30150,
    baseAmount: 30150,
    quantity: 3000,
    pricePerUnit: 10.05,
    grossAmount: 30150,
    feeAmount: 18.5,
    netAmount: 30168.5,
    reference: "SEED-MOOMOO-MAYBANK-BUY-001",
    notes: "Local bank equity position",
  });

  await createNavWeek({
    weekEnding: "2026-03-13",
    settlementDate: "2026-03-13",
    platformSnapshots: [
      { platformId: ibkr.rows[0].id, unrealizedProfit: 2180 },
      { platformId: moomoo.rows[0].id, unrealizedProfit: -420 },
      { platformId: binance.rows[0].id, unrealizedProfit: 0 },
      { platformId: maybank.rows[0].id, unrealizedProfit: 0 },
    ],
    adjustments: 0,
    notes: "First funded trading week with unallocated operating cash",
  });
  const week2 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-03-13'`;
  await lockNavWeek(week2.rows[0].id);
  await recordCashMovement({ investorId: farah.rows[0].id, date: "2026-03-16", type: "Deposit", amount: 24000, notes: "Secondary equity subscription" });
  await recordCashMovement({ investorId: grace.rows[0].id, date: "2026-03-16", type: "Deposit", amount: 65000, notes: "New investor equity subscription" });
  await recordFixedSavings({ investorId: ben.rows[0].id, date: "2026-03-17", type: "Deposit", amount: 16000, notes: "Fixed savings diversification" });
  await recordFixedSavings({ investorId: grace.rows[0].id, date: "2026-03-17", type: "Deposit", amount: 25000, notes: "Fixed savings placement" });
  await insertPlatformTransaction({
    platformId: binance.rows[0].id,
    accountId: binanceSpot.rows[0].id,
    date: "2026-03-18",
    type: "BROKER_DEPOSIT",
    amount: 30000,
    baseAmount: 30000,
    reference: "SEED-BINANCE-FUNDING-001",
    notes: "Digital asset allocation funded from mixed sources",
    allocations: [
      { fundingSource: "equity", ratioPercent: 66.6667, baseAmount: 20000 },
      { fundingSource: "fixed_savings", ratioPercent: 33.3333, baseAmount: 10000 },
    ],
  });
  await insertPlatformTransaction({
    platformId: binance.rows[0].id,
    accountId: binanceSpot.rows[0].id,
    assetId: btc.rows[0].id,
    date: "2026-03-19",
    type: "BUY",
    amount: 6369.43,
    currency: "USDT",
    baseAmount: 30000,
    fxRateToBase: 4.71,
    quantity: 0.06125,
    pricePerUnit: 103990,
    grossAmount: 29972.5,
    feeAmount: 27.5,
    netAmount: 30000,
    reference: "SEED-BINANCE-BTC-BUY-001",
    notes: "BTC spot position",
  });
  await insertPlatformTransaction({
    platformId: ibkr.rows[0].id,
    accountId: ibkrMargin.rows[0].id,
    assetId: aapl.rows[0].id,
    date: "2026-03-20",
    type: "BUY",
    amount: 8411.9,
    currency: "USD",
    baseAmount: 39725,
    fxRateToBase: 4.722,
    quantity: 42,
    pricePerUnit: 200.12,
    grossAmount: 39710,
    feeAmount: 15,
    netAmount: 39725,
    reference: "SEED-IBKR-AAPL-BUY-001",
    notes: "US single-name equity allocation",
  });

  await createNavWeek({
    weekEnding: "2026-03-20",
    settlementDate: "2026-03-20",
    platformSnapshots: [
      { platformId: ibkr.rows[0].id, unrealizedProfit: 6420 },
      { platformId: moomoo.rows[0].id, unrealizedProfit: 1180 },
      { platformId: binance.rows[0].id, unrealizedProfit: 2650 },
      { platformId: maybank.rows[0].id, unrealizedProfit: 0 },
    ],
    adjustments: 79000,
    notes: "Growth week after secondary subscriptions and unallocated cash",
  });
  const week3 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-03-20'`;
  await lockNavWeek(week3.rows[0].id);
  await recordCashMovement({ investorId: ben.rows[0].id, date: "2026-03-23", type: "Withdrawal", amount: 9000, notes: "Partial equity redemption" });
  await recordCashMovement({ investorId: chandra.rows[0].id, date: "2026-03-23", type: "Deposit", amount: 12000, notes: "Top-up subscription" });
  await recordFixedSavings({ investorId: alice.rows[0].id, date: "2026-03-24", type: "Withdrawal", amount: 4500, notes: "Partial fixed savings withdrawal" });
  await insertPlatformTransaction({
    platformId: ibkr.rows[0].id,
    accountId: ibkrMargin.rows[0].id,
    assetId: aapl.rows[0].id,
    date: "2026-03-24",
    type: "SELL",
    amount: 4210.1,
    currency: "USD",
    baseAmount: 19875,
    fxRateToBase: 4.72,
    quantity: 20,
    pricePerUnit: 210.5,
    grossAmount: 19890,
    feeAmount: 15,
    netAmount: 19875,
    realizedProfit: 1015,
    reference: "SEED-IBKR-AAPL-SELL-001",
    notes: "Partial AAPL profit realization",
  });
  await insertPlatformTransaction({
    platformId: maybank.rows[0].id,
    accountId: reserveCash.rows[0].id,
    date: "2026-03-25",
    type: "BROKER_DEPOSIT",
    amount: 9500,
    baseAmount: 9500,
    reference: "SEED-RESERVE-FUNDING-002",
    notes: "Brokerage fee and realized gain reserve",
    allocations: [
      { fundingSource: "equity", ratioPercent: 100, baseAmount: 9500 },
    ],
  });

  await createNavWeek({
    weekEnding: "2026-03-27",
    settlementDate: "2026-03-27",
    platformSnapshots: [
      { platformId: ibkr.rows[0].id, unrealizedProfit: 3925 },
      { platformId: moomoo.rows[0].id, unrealizedProfit: 2340 },
      { platformId: binance.rows[0].id, unrealizedProfit: -1120 },
      { platformId: maybank.rows[0].id, unrealizedProfit: 0 },
    ],
    adjustments: 75825,
    notes: "Mixed P/L week with one redemption and retained cash",
  });
  const week4 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-03-27'`;
  await lockNavWeek(week4.rows[0].id);

  const latestNav = await sql`
    SELECT id, nav_per_unit
    FROM nav_weeks
    WHERE status = 'locked'
    ORDER BY week_ending DESC
    LIMIT 1
  `;
  const navPerUnit = parseFloat(latestNav.rows[0].nav_per_unit);
  const aliceBonusAmount = 1250;
  const aliceBonusUnits = issueUnitsForDeposit({ amount: aliceBonusAmount, navPerUnit });
  const aliceBonusUnit = await sql`
    INSERT INTO investor_unit_ledger (investor_id, nav_week_id, date, type, units, nav_per_unit, gross_amount, notes)
    VALUES (${alice.rows[0].id}, ${latestNav.rows[0].id}, '2026-03-30', 'UnitIssue', ${aliceBonusUnits}, ${navPerUnit}, ${aliceBonusAmount}, 'Manager discretionary equity bonus')
    RETURNING id
  `;
  const aliceBonus = await sql`
    INSERT INTO bonus_payments (investor_id, ledger_type, source_id, amount, date, notes)
    VALUES (${alice.rows[0].id}, 'equity', ${aliceBonusUnit.rows[0].id}, ${aliceBonusAmount}, '2026-03-30', 'Manager discretionary equity bonus')
    RETURNING id
  `;
  const graceSavingsBonusLedger = await sql`
    INSERT INTO fixed_savings_ledger (investor_id, date, type, amount, notes)
    VALUES (${grace.rows[0].id}, '2026-03-30', 'Bonus', 380, 'Fixed savings loyalty bonus')
    RETURNING id
  `;
  const graceBonus = await sql`
    INSERT INTO bonus_payments (investor_id, ledger_type, source_id, amount, date, notes)
    VALUES (${grace.rows[0].id}, 'fixed_savings', ${graceSavingsBonusLedger.rows[0].id}, 380, '2026-03-30', 'Fixed savings loyalty bonus')
    RETURNING id
  `;

  await createNavWeek({
    weekEnding: "2026-04-03",
    settlementDate: "2026-04-03",
    platformSnapshots: [
      { platformId: ibkr.rows[0].id, unrealizedProfit: 7825 },
      { platformId: moomoo.rows[0].id, unrealizedProfit: 3140 },
      { platformId: binance.rows[0].id, unrealizedProfit: 4850 },
      { platformId: maybank.rows[0].id, unrealizedProfit: 0 },
    ],
    adjustments: 77075,
    notes: "Latest demo locked NAV with positive cross-platform P/L and retained cash",
  });
  const week5 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-04-03'`;
  await lockNavWeek(week5.rows[0].id);
  await seedWeeklyDemoHistory("2026-04-10", "2026-06-05", nextSeedIndex);

  await sql`
    INSERT INTO performance_fees (investor_id, nav_week_id, crystallized_gain, fee_rate_percent, fee_amount, date, notes)
    VALUES
      (${ben.rows[0].id}, ${week3.rows[0].id}, 1750, 2.0, 35, '2026-03-23', 'Withdrawal crystallized performance fee'),
      (${chandra.rows[0].id}, ${week5.rows[0].id}, 2400, 2.0, 48, '2026-04-03', 'Quarterly realized gain fee accrual')
  `;
  await sql`
    INSERT INTO investor_profit_claims (investor_id, locked_amount, settled_amount, brokerage_fee, status, claim_date, settled_date, notes)
    VALUES
      (${alice.rows[0].id}, 3200, 3136, 64, 'settled', '2026-03-31', '2026-04-02', 'March realized profit distribution'),
      (${chandra.rows[0].id}, 1800, 900, 36, 'partial', '2026-04-01', '2026-04-03', 'Partial settlement for realized strategy profit'),
      (${grace.rows[0].id}, 2100, 0, 42, 'pending', '2026-04-03', NULL, 'Pending approval for April profit cycle')
  `;
  await sql`
    INSERT INTO capital_ledger (investor_id, date, type, amount, notes)
    VALUES
      (${alice.rows[0].id}, '2026-04-02', 'ProfitDistribution', 3136, 'Settled March profit claim net of brokerage fee'),
      (${chandra.rows[0].id}, '2026-04-03', 'ProfitDistribution', 900, 'Partial profit claim settlement'),
      (${alice.rows[0].id}, '2026-03-30', 'Bonus', 1250, 'Mirror entry for equity bonus visibility')
  `;
  await sql`
    INSERT INTO fund_cash_valuations (as_of_date, balance, notes)
    VALUES ('2026-04-05', 34500, 'Operating reserve from bank statement')
    ON CONFLICT (as_of_date) DO NOTHING
  `;
  await sql`
    INSERT INTO trading_ledger (date, platform, ticker, type, currency, price, quantity, amount_rm, profit_loss, date_closed, receipt_url)
    VALUES
      ('2026-03-13', 'Interactive Brokers', 'VOO', 'BUY', 'USD', 515.3000, 64, 155850.00, NULL, NULL, NULL),
      ('2026-03-20', 'Interactive Brokers', 'AAPL', 'BUY', 'USD', 200.1200, 42, 39725.00, NULL, NULL, NULL),
      ('2026-03-24', 'Interactive Brokers', 'AAPL', 'SELL', 'USD', 210.5000, 20, 19875.00, 1015.00, '2026-03-24', NULL),
      ('2026-03-13', 'Moomoo Malaysia', 'MAYBANK', 'BUY', 'MYR', 10.0500, 3000, 30168.50, NULL, NULL, NULL),
      ('2026-03-19', 'Binance Custody', 'BTC', 'BUY', 'USDT', 103990.0000, 0.0613, 30000.00, NULL, NULL, NULL)
  `;
  await writeAuditEvent("bonus_payment.add", "bonus_payments", aliceBonus.rows[0].id, {
    investorId: alice.rows[0].id,
    ledgerType: "equity",
    amount: aliceBonusAmount,
    seed: "development-demo",
  });
  await writeAuditEvent("bonus_payment.add", "bonus_payments", graceBonus.rows[0].id, {
    investorId: grace.rows[0].id,
    ledgerType: "fixed_savings",
    amount: 380,
    seed: "development-demo",
  });
  await writeAuditEvent("fixed_savings_rate.seed", "fixed_savings_base_rates", null, {
    baseRates: [
      { effectiveDate: "2026-03-01", annualRatePercent: 4.0 },
      { effectiveDate: "2026-04-01", annualRatePercent: 4.25 },
      { effectiveDate: "2026-07-01", annualRatePercent: 4.1 },
    ],
    promotions: [
      { name: "Seed 5% Launch Promo", startDate: "2026-03-15", endDate: "2026-06-14", annualRatePercent: 5.0, balanceCap: 50000, status: "active" },
      { name: "Seed Expired 4.8% Promo", startDate: "2026-01-01", endDate: "2026-02-28", annualRatePercent: 4.8, status: "disabled" },
    ],
  });
  await writeAuditEvent("portal_access.rotate", "investors", alice.rows[0].id, { seed: "development-demo" });
  await writeAuditEvent("development.seed", "database", null, {
    seed: "complete-development-fund",
    investors: 5,
    platforms: 4,
    lockedNavWeeks: 127,
    fixedSavingsBaseRates: 3,
    fixedSavingsPromotions: 2,
    portalAccessIds: [
      "demo-alice-tan-2026",
      "demo-ben-lim-2026",
      "demo-chandra-kumar-2026",
      "demo-farah-rahman-2026",
      "demo-grace-wong-2026",
    ],
  });
  await sql`
    INSERT INTO portal_access_events (investor_id, portal_access_hash, client_key, user_agent, outcome)
    VALUES
      (${alice.rows[0].id}, ${hashPortalAccessId("demo-alice-tan-2026")}, 'seed-browser', 'Development seed import', 'success'),
      (${ben.rows[0].id}, ${hashPortalAccessId("demo-ben-lim-2026")}, 'seed-browser', 'Development seed import', 'success'),
      (NULL, ${hashPortalAccessId("invalid-demo-token")}, 'seed-browser', 'Development seed import', 'not_found')
  `;
}
