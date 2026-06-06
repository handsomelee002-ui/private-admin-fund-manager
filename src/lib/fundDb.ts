import { sql } from "@vercel/postgres";
import { createHash, randomUUID } from "node:crypto";
import {
  calculateBrokerageFundingAllocation,
  calculateNavPerUnit,
  calculateOwnershipPercent,
  issueUnitsForDeposit,
  redeemUnitsForWithdrawal,
  roundMoney,
  roundUnits,
} from "@/lib/accounting";
import { requireAdmin } from "@/lib/auth";
import { BACKUP_TABLES, assertBackupTableName } from "@/lib/backupTables";

export type CashMovementType = "Deposit" | "Withdrawal";
export type NavStatus = "draft" | "locked";

type NavWeekInput = {
  weekEnding: string;
  settlementDate?: string;
  platformSnapshots: PlatformSnapshotInput[];
  adjustments: number;
  notes?: string;
};

type PlatformSnapshotInput = {
  platformId: string;
  unrealizedProfit: number;
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
    } else if (row.type === "UnitRedemption" && units > 0) {
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
  let totalInterest = 0;

  while (currentDate < endDate) {
    const baseRate = baseRateForDate(currentDate, rates.baseRates, fallbackRate);
    const promotion = promotionForDate(currentDate, rates.promotions);
    const baseDailyRate = baseRate / 100 / 365;
    let dailyInterest = currentBalance * baseDailyRate;

    if (promotion) {
      const promotedBalance = promotion.balanceCap == null
        ? currentBalance
        : Math.min(currentBalance, promotion.balanceCap);
      const standardBalance = Math.max(0, currentBalance - promotedBalance);
      dailyInterest = (promotedBalance * (promotion.annualRatePercent / 100 / 365)) + (standardBalance * baseDailyRate);
    }

    currentBalance += dailyInterest;
    totalInterest += dailyInterest;
    currentDate = addDaysIso(currentDate, 1);
  }

  return { balance: roundMoney(currentBalance), interest: roundMoney(totalInterest) };
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

  const investorStates = new Map<string, { principal: number; accruedInterest: number; bonusPayable: number; balance: number; accruedThrough: string; fallbackRate: number }>();

  function stateFor(row: FixedSavingsLedgerRow) {
    const investorId = row.investor_id || "fund";
    const existing = investorStates.get(investorId);
    if (existing) return existing;
    const state = {
      principal: 0,
      accruedInterest: 0,
      bonusPayable: 0,
      balance: 0,
      accruedThrough: row.date,
      fallbackRate: ledgerRate(row),
    };
    investorStates.set(investorId, state);
    return state;
  }

  function accrueState(state: { principal: number; accruedInterest: number; balance: number; accruedThrough: string; fallbackRate: number }, date: string) {
    const result = accruePooledNominalInterest({
      balance: state.balance,
      startDate: state.accruedThrough,
      endDate: date,
      fallbackRate: state.fallbackRate,
      rateInput,
    });
    state.balance = result.balance;
    state.accruedInterest = roundMoney(state.accruedInterest + result.interest);
    state.accruedThrough = date;
  }

  function reduceState(state: { principal: number; accruedInterest: number; bonusPayable: number; balance: number }, amount: number) {
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
  let bonusPayable = 0;
  const byInvestor = new Map<string, { principal: number; accruedInterest: number; bonusPayable: number; payableInterest: number; totalLiability: number }>();

  for (const [investorId, state] of investorStates.entries()) {
    principal = roundMoney(principal + state.principal);
    accruedInterest = roundMoney(accruedInterest + state.accruedInterest);
    bonusPayable = roundMoney(bonusPayable + state.bonusPayable);
    byInvestor.set(investorId, {
      principal: roundMoney(state.principal),
      accruedInterest: roundMoney(state.accruedInterest),
      bonusPayable: roundMoney(state.bonusPayable),
      payableInterest: roundMoney(state.accruedInterest + state.bonusPayable),
      totalLiability: roundMoney(state.balance),
    });
  }

  return {
    principal: roundMoney(principal),
    accruedInterest: roundMoney(accruedInterest),
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
      brokerage_fee NUMERIC(15, 4) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      claim_date DATE NOT NULL,
      settled_date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE investor_profit_claims ADD COLUMN IF NOT EXISTS brokerage_fee NUMERIC(15, 4) NOT NULL DEFAULT 0`;
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
      UNIQUE(nav_week_id, platform_id)
    );
  `;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS total_value NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS equity_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS fixed_savings_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS brokerage_net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS equity_unrealized_profit NUMERIC(15, 4) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE nav_week_platform_snapshots ADD COLUMN IF NOT EXISTS brokerage_profit_loss NUMERIC(15, 4) NOT NULL DEFAULT 0`;
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
    CREATE TABLE IF NOT EXISTS cash_balances (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      account_name TEXT NOT NULL,
      current_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
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

export async function writeAuditEvent(action: string, entityType: string, entityId: string | null, details = {}) {
  await sql`
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
      gross_assets, liabilities, adjustments, net_asset_value,
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
      gross_assets, liabilities, adjustments, net_asset_value,
      total_units, nav_per_unit, status, locked_at, notes, created_at
    FROM nav_weeks
    ORDER BY nav_weeks.week_ending DESC
  `;
  return res.rows;
}

export async function createNavWeek(input: NavWeekInput) {
  const existingWeek = await sql`SELECT status FROM nav_weeks WHERE week_ending = ${input.weekEnding}`;
  if (existingWeek.rows[0]?.status === "locked") {
    throw new Error("Locked NAV weeks cannot be modified.");
  }
  const totalUnits = await getTotalUnits();
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
        END as brokerage_cash_flow
      FROM platform_transactions pt
      LEFT JOIN platform_transaction_allocations pta ON pta.transaction_id = pt.id
      GROUP BY pt.id
    )
    SELECT
      p.id,
      COALESCE(SUM(tf.cash_flow), 0) as net_invested,
      COALESCE(SUM(tf.equity_cash_flow), 0) as equity_net_invested,
      COALESCE(SUM(tf.fixed_savings_cash_flow), 0) as fixed_savings_net_invested,
      COALESCE(SUM(tf.brokerage_cash_flow), 0) as brokerage_net_invested
    FROM platforms p
    LEFT JOIN transaction_flows tf ON tf.platform_id = p.id
    GROUP BY p.id
    ORDER BY p.id
  `;
  const snapshotByPlatform = new Map(input.platformSnapshots.map((snapshot) => [snapshot.platformId, snapshot.unrealizedProfit]));
  const platformSnapshots = platforms.rows.map((platform: any) => {
    const totalNetInvested = roundMoney(parseFloat(platform.net_invested || "0"));
    const totalValue = roundMoney(totalNetInvested + (snapshotByPlatform.get(platform.id) ?? 0));
    const allocation = calculateBrokerageFundingAllocation({
      equityNetInvested: parseFloat(platform.equity_net_invested || "0"),
      fixedSavingsNetInvested: parseFloat(platform.fixed_savings_net_invested || "0"),
      brokerageNetInvested: parseFloat(platform.brokerage_net_invested || "0"),
      totalValue,
    });
    return {
      platformId: platform.id as string,
      netInvested: allocation.equityNetInvested,
      unrealizedProfit: allocation.equityProfitLoss,
      totalValue,
      allocation,
    };
  });
  const grossAssets = roundMoney(
    platformSnapshots.reduce((sum, snapshot) => sum + snapshot.allocation.equityNavValue, 0),
  );
  const liabilities = 0;
  const netAssetValue = roundMoney(grossAssets - liabilities + input.adjustments);
  const navPerUnit = calculateNavPerUnit({ netAssetValue, totalUnits });
  const settlementDate = input.settlementDate || input.weekEnding;

  const res = await sql`
    INSERT INTO nav_weeks (
      week_ending, settlement_date, gross_assets, liabilities, adjustments,
      net_asset_value, total_units, nav_per_unit, status, notes
    )
    VALUES (
      ${input.weekEnding}, ${settlementDate}, ${grossAssets}, ${liabilities}, ${input.adjustments},
      ${netAssetValue}, ${totalUnits}, ${navPerUnit}, 'draft', ${input.notes || ""}
    )
    ON CONFLICT (week_ending) DO UPDATE SET
      settlement_date = EXCLUDED.settlement_date,
      gross_assets = EXCLUDED.gross_assets,
      liabilities = EXCLUDED.liabilities,
      adjustments = EXCLUDED.adjustments,
      net_asset_value = EXCLUDED.net_asset_value,
      total_units = EXCLUDED.total_units,
      nav_per_unit = EXCLUDED.nav_per_unit,
      notes = EXCLUDED.notes
    RETURNING id
  `;
  const navWeekId = res.rows[0].id;
  await sql`DELETE FROM nav_week_platform_snapshots WHERE nav_week_id = ${navWeekId}`;
  for (const snapshot of platformSnapshots) {
    await sql`
      INSERT INTO nav_week_platform_snapshots (
        nav_week_id, platform_id, net_invested, unrealized_profit, total_value,
        equity_net_invested, fixed_savings_net_invested, brokerage_net_invested,
        equity_unrealized_profit, brokerage_profit_loss
      )
      VALUES (
        ${navWeekId}, ${snapshot.platformId}, ${snapshot.netInvested}, ${snapshot.unrealizedProfit}, ${snapshot.totalValue},
        ${snapshot.allocation.equityNetInvested}, ${snapshot.allocation.fixedSavingsNetInvested}, ${snapshot.allocation.brokerageNetInvested},
        ${snapshot.allocation.equityProfitLoss}, ${snapshot.allocation.brokerageProfitLoss}
      )
    `;
  }
  await writeAuditEvent("nav_week.upsert", "nav_weeks", navWeekId, {
    weekEnding: input.weekEnding,
    grossAssets,
    platformCount: platformSnapshots.length,
  });
  return { success: true };
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

  const locked = await sql`UPDATE nav_weeks SET status = 'locked', locked_at = NOW() WHERE id = ${id} AND status = 'draft' RETURNING id`;
  if (locked.rows.length === 0) throw new Error("Only draft NAV weeks can be locked.");
  await writeAuditEvent("nav_week.lock", "nav_weeks", id);
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

  const deleted = await sql`DELETE FROM nav_weeks WHERE id = ${id} AND status = 'draft' RETURNING id`;
  if (deleted.rows.length === 0) throw new Error("Only draft NAV weeks can be deleted.");
  await writeAuditEvent("nav_week.delete_draft", "nav_weeks", id);
  return { success: true };
}

export async function recordCashMovement(input: CashMovementInput) {
  await ensureAuditColumns();
  const navWeek = await getLatestLockedNavWeek();
  if (!navWeek) {
    return { error: "Cash movements require at least one locked weekly NAV." };
  }

  const navPerUnit = parseFloat(navWeek.nav_per_unit);
  let ledgerType = "UnitIssue";
  let units = 0;
  let grossAmount = roundMoney(input.amount);
  let brokerageFee = 0;
  let realizedGain = 0;
  let performanceFeeId: string | null = null;

  if (input.type === "Deposit") {
    units = issueUnitsForDeposit({ amount: input.amount, navPerUnit });
  } else {
    ledgerType = "UnitRedemption";
    const priorLedger = await sql`
      SELECT iul.type, iul.units, iul.gross_amount, iul.audit_status, TO_CHAR(iul.date, 'YYYY-MM-DD') as date,
        CASE WHEN bp.id IS NULL THEN false ELSE true END as is_bonus
      FROM investor_unit_ledger iul
      LEFT JOIN bonus_payments bp ON bp.source_id = iul.id AND bp.ledger_type = 'equity'
      WHERE iul.investor_id = ${input.investorId}
      ORDER BY iul.date ASC, iul.created_at ASC
    `;
    const equityPosition = calculateEquityCapitalPosition(priorLedger.rows as EquityUnitLedgerRow[]);
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
      const brokerageRate = await getBrokerageFeeRateValue();
      brokerageFee = roundMoney(realizedGain * (brokerageRate / 100));
      if (brokerageFee > 0) {
        const fee = await sql`
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
    }
  }

  const unitLedger = await sql`
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
  const cashMovement = await sql`
    INSERT INTO cash_movements (investor_id, nav_week_id, unit_ledger_id, date, type, amount, status, notes)
    VALUES (
      ${input.investorId},
      ${navWeek.id},
      ${unitLedger.rows[0].id},
      ${input.date},
      ${input.type},
      ${grossAmount},
      'settled',
      ${input.type === "Withdrawal" && brokerageFee > 0
        ? `${input.notes || "Withdrawal"} | Brokerage fee RM ${brokerageFee.toFixed(2)}`
        : input.notes || ""}
    )
    RETURNING id
  `;
  await writeAuditEvent("cash_movement.add", "cash_movements", cashMovement.rows[0].id, {
    type: input.type,
    amount: grossAmount,
    units,
    brokerageFee,
    realizedGain,
    unitLedgerId: unitLedger.rows[0].id,
    performanceFeeId,
  });
  return { success: true };
}

export async function recordFixedSavings(input: FixedSavingsInput) {
  await ensureAuditColumns();
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
    const savingsSummary = savingsByInvestor.get(row.id) ?? {
      principal: 0,
      accruedInterest: 0,
      bonusPayable: 0,
      payableInterest: 0,
      totalLiability: 0,
    };
    return {
      ...row,
      units,
      netInvestedCapital: equityPosition.investedCapital,
      marketValue: roundMoney(units * navPerUnit),
      ownershipPercent: calculateOwnershipPercent({ investorUnits: units, totalUnits }),
      fixedSavingsPrincipal: savingsSummary.principal,
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
          gross_assets, liabilities, adjustments, net_asset_value,
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
  const equityPosition = calculateEquityCapitalPosition(
    [...unitLedger.rows]
      .sort((a: any, b: any) => {
        const dateOrder = String(a.date).localeCompare(String(b.date));
        if (dateOrder !== 0) return dateOrder;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      }) as EquityUnitLedgerRow[],
  );
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
    marketValue: roundMoney(units * navPerUnit),
    ownershipPercent: calculateOwnershipPercent({ investorUnits: units, totalUnits }),
    unitLedger: unitLedger.rows,
    cashMovements: cash.rows,
    savingsLedger: savings.rows,
    bonusLedger: bonuses.rows,
    performanceFees: fees.rows,
    activityLedger,
    savingsPrincipal: savingsSummary.principal,
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

export async function getFundSummaryMetrics() {
  await requireAdmin();
  await ensureAuditColumns();
  const [summary, savings, rateInput] = await Promise.all([
    sql`
      WITH latest_nav AS (
        SELECT id,
          TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending,
          TO_CHAR(settlement_date, 'YYYY-MM-DD') as settlement_date,
          gross_assets, liabilities, adjustments, net_asset_value,
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
          gross_assets, liabilities, adjustments, net_asset_value,
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
    const savingsSummary = savingsByInvestor.get(row.id) ?? {
      principal: 0,
      accruedInterest: 0,
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
      marketValue: roundMoney(units * navPerUnit),
      ownershipPercent: calculateOwnershipPercent({ investorUnits: units, totalUnits }),
      fixedSavingsPrincipal: savingsSummary.principal,
      fixedSavingsInterest: savingsSummary.payableInterest,
      fixedSavingsBalance: savingsSummary.totalLiability,
    };
  });
  return {
    latestNav,
    totalUnits,
    fixedSavingsLiability: fixedSavings.totalLiability,
    fixedSavingsPrincipal: fixedSavings.principal,
    fixedSavingsInterest: fixedSavings.payableInterest,
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
    VALUES (${ibkr.rows[0].id}, 'Margin Portfolio', 'BROKER_MARGIN', 'USD')
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
    VALUES (${binance.rows[0].id}, 'Spot Wallet', 'CRYPTO_SPOT', 'USDT')
    RETURNING id
  `;
  const reserveCash = await sql`
    INSERT INTO platform_accounts (platform_id, name, account_type, currency)
    VALUES (${maybank.rows[0].id}, 'Operating Reserve', 'BANK_CASH', 'MYR')
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
      { fundingSource: "brokerage", ratioPercent: 35, baseAmount: 3325 },
      { fundingSource: "equity", ratioPercent: 65, baseAmount: 6175 },
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
    INSERT INTO cash_balances (account_name, current_balance)
    VALUES
      ('Maybank Operating Reserve', 34500),
      ('IBKR USD Cash Equivalent', 18750),
      ('Moomoo MYR Available Cash', 14820),
      ('Binance USDT Available Cash', 6220)
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
    lockedNavWeeks: 5,
    fixedSavingsBaseRates: 4,
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
