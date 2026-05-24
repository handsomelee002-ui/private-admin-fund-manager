import { sql } from "@vercel/postgres";
import {
  accrueDailyCompoundInterest,
  calculateNavPerUnit,
  calculateOwnershipPercent,
  issueUnitsForDeposit,
  redeemUnitsForWithdrawal,
  roundMoney,
  roundUnits,
} from "@/lib/accounting";
import { requireAdmin } from "@/lib/auth";

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
  annualRatePercent?: number | null;
  notes?: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const DEFAULT_BROKERAGE_FEE_RATE = "2.0";
const RESETTABLE_FINANCIAL_TABLES = [
  "audit_events",
  "performance_fees",
  "nav_week_platform_snapshots",
  "fixed_savings_ledger",
  "fixed_savings_accounts",
  "cash_movements",
  "investor_unit_ledger",
  "nav_weeks",
  "bonus_payments",
  "investor_profit_claims",
  "capital_ledger",
  "platform_transactions",
  "platform_performance",
  "platforms",
  "trading_ledger",
  "cash_balances",
  "investors",
  "fund_config",
] as const;

function assertResettableTableName(tableName: string) {
  if (!RESETTABLE_FINANCIAL_TABLES.includes(tableName as (typeof RESETTABLE_FINANCIAL_TABLES)[number])) {
    throw new Error(`Refusing to reset unapproved table: ${tableName}`);
  }
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
}

function ledgerAmount(row: FixedSavingsLedgerRow) {
  return parseFloat(String(row.amount || "0"));
}

function ledgerRate(row: FixedSavingsLedgerRow, fallback = 0) {
  const rawRate = row.annual_rate_percent ?? row.interest_rate ?? fallback;
  return parseFloat(String(rawRate || "0"));
}

export async function ensureAuditColumns() {
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
  await sql`ALTER TABLE performance_fees ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE performance_fees ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE bonus_payments ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS audit_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS reversal_of_id UUID`;
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

export function calculateFixedSavingsLiability(rows: FixedSavingsLedgerRow[], endDate = todayIso()) {
  const orderedRows = [...rows].sort((a, b) => {
    const dateOrder = String(a.date).localeCompare(String(b.date));
    if (dateOrder !== 0) return dateOrder;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  const accountInterestState = new Map<string, { balance: number; annualRatePercent: number; accruedThrough: string }>();
  const investorSummaries = new Map<string, { principal: number; accruedInterest: number; bonusPayable: number }>();
  let principal = 0;
  let accruedInterest = 0;
  let bonusPayable = 0;

  function investorSummary(investorId: string | undefined) {
    if (!investorId) return null;
    const existing = investorSummaries.get(investorId) ?? { principal: 0, accruedInterest: 0, bonusPayable: 0 };
    investorSummaries.set(investorId, existing);
    return existing;
  }

  for (const movement of orderedRows) {
    const amount = ledgerAmount(movement);
    const accountKey = movement.account_id || `legacy:${movement.investor_id || "fund"}`;
    const state = accountInterestState.get(accountKey) ?? {
      balance: 0,
      annualRatePercent: ledgerRate(movement),
      accruedThrough: movement.date,
    };
    const summary = investorSummary(movement.investor_id);

    if (state.balance > 0 && state.annualRatePercent > 0) {
      const interest = accrueDailyCompoundInterest({
        principal: state.balance,
        annualRatePercent: state.annualRatePercent,
        startDate: state.accruedThrough,
        endDate: movement.date,
      });
      accruedInterest += interest;
      if (summary) summary.accruedInterest += interest;
    }

    state.accruedThrough = movement.date;
    if (movement.type === "Deposit") {
      state.balance += amount;
      state.annualRatePercent = ledgerRate(movement, state.annualRatePercent);
      principal += amount;
      if (summary) summary.principal += amount;
    } else if (movement.type === "Withdrawal") {
      const withdrawal = Math.min(amount, state.balance);
      state.balance = Math.max(0, state.balance - amount);
      principal -= withdrawal;
      if (summary) summary.principal -= withdrawal;
    } else if (movement.type === "Bonus") {
      bonusPayable += amount;
      if (summary) summary.bonusPayable += amount;
    }
    accountInterestState.set(accountKey, state);
  }

  for (const [accountKey, state] of accountInterestState.entries()) {
    if (state.balance <= 0 || state.annualRatePercent <= 0) continue;
    const interest = accrueDailyCompoundInterest({
      principal: state.balance,
      annualRatePercent: state.annualRatePercent,
      startDate: state.accruedThrough,
      endDate,
    });
    accruedInterest += interest;
    const investorId = accountKey.startsWith("legacy:") ? accountKey.split(":")[1] : orderedRows.find((row) => row.account_id === accountKey)?.investor_id;
    const summary = investorSummary(investorId);
    if (summary) summary.accruedInterest += interest;
  }

  return {
    principal: roundMoney(principal),
    accruedInterest: roundMoney(accruedInterest),
    bonusPayable: roundMoney(bonusPayable),
    payableInterest: roundMoney(accruedInterest + bonusPayable),
    totalLiability: roundMoney(principal + accruedInterest + bonusPayable),
    byInvestor: new Map(
      [...investorSummaries.entries()].map(([investorId, summary]) => [
        investorId,
        {
          principal: roundMoney(summary.principal),
          accruedInterest: roundMoney(summary.accruedInterest),
          bonusPayable: roundMoney(summary.bonusPayable),
          payableInterest: roundMoney(summary.accruedInterest + summary.bonusPayable),
          totalLiability: roundMoney(summary.principal + summary.accruedInterest + summary.bonusPayable),
        },
      ]),
    ),
  };
}

export async function initializeFreshFundDatabase() {
  await ensureFreshFundSchema();
  await resetFundConfigDefaults();
  await writeAuditEvent("development.initialize_schema", "database", null, {
    brokerageFeePercent: DEFAULT_BROKERAGE_FEE_RATE,
  });
}

async function ensureInvestorPortalAccessColumns() {
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS portal_access_id TEXT`;
  await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS portal_access_rotated_at TIMESTAMPTZ`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS investors_portal_access_id_key
    ON investors (portal_access_id)
    WHERE portal_access_id IS NOT NULL
  `;
}

export async function ensureFreshFundSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS investors (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      portal_access_id TEXT UNIQUE,
      portal_access_rotated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await ensureInvestorPortalAccessColumns();
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
      type TEXT NOT NULL CHECK (type IN ('Deposit', 'Withdrawal', 'Bonus')),
      amount NUMERIC(15, 4) NOT NULL,
      annual_rate_percent NUMERIC(8, 4),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES fixed_savings_accounts(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS annual_rate_percent NUMERIC(8, 4)`;
  await sql`ALTER TABLE fixed_savings_ledger ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(8, 4) DEFAULT NULL`;
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS nav_week_platform_snapshots (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      nav_week_id UUID NOT NULL REFERENCES nav_weeks(id) ON DELETE CASCADE,
      platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      net_invested NUMERIC(15, 4) NOT NULL DEFAULT 0,
      unrealized_profit NUMERIC(15, 4) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(nav_week_id, platform_id)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_transactions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      type TEXT NOT NULL,
      amount NUMERIC(15, 4) NOT NULL,
      realized_profit NUMERIC(15, 4) DEFAULT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS realized_profit NUMERIC(15, 4) DEFAULT NULL`;
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
  `;
  return roundUnits(parseFloat(res.rows[0]?.total || "0"));
}

export async function getInvestorUnits(investorId: string) {
  const res = await sql`
    SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as total
    FROM investor_unit_ledger
    WHERE investor_id = ${investorId}
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
    SELECT
      p.id,
      COALESCE(SUM(CASE WHEN pt.type = 'Deposit' THEN pt.amount ELSE -pt.amount END), 0) as net_invested
    FROM platforms p
    LEFT JOIN platform_transactions pt ON pt.platform_id = p.id
    GROUP BY p.id
    ORDER BY p.id
  `;
  const snapshotByPlatform = new Map(input.platformSnapshots.map((snapshot) => [snapshot.platformId, snapshot.unrealizedProfit]));
  const platformSnapshots = platforms.rows.map((platform: any) => ({
    platformId: platform.id as string,
    netInvested: roundMoney(parseFloat(platform.net_invested || "0")),
    unrealizedProfit: roundMoney(snapshotByPlatform.get(platform.id) ?? 0),
  }));
  const grossAssets = roundMoney(
    platformSnapshots.reduce((sum, snapshot) => sum + snapshot.netInvested + snapshot.unrealizedProfit, 0),
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
      INSERT INTO nav_week_platform_snapshots (nav_week_id, platform_id, net_invested, unrealized_profit)
      VALUES (${navWeekId}, ${snapshot.platformId}, ${snapshot.netInvested}, ${snapshot.unrealizedProfit})
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
  await sql`UPDATE nav_weeks SET status = 'locked', locked_at = NOW() WHERE id = ${id}`;
  await writeAuditEvent("nav_week.lock", "nav_weeks", id);
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
  let accountId: string | null = null;
  if (input.type === "Deposit") {
    const account = await sql`
      INSERT INTO fixed_savings_accounts (investor_id, opened_at, annual_rate_percent)
      VALUES (${input.investorId}, ${input.date}, ${input.annualRatePercent || 0})
      RETURNING id
    `;
    accountId = account.rows[0].id;
  } else {
    const account = await sql`
      SELECT fsa.id,
        COALESCE(SUM(CASE WHEN fsl.type = 'Deposit' THEN fsl.amount WHEN fsl.type = 'Withdrawal' THEN -fsl.amount ELSE 0 END), 0) as balance
      FROM fixed_savings_accounts fsa
      LEFT JOIN fixed_savings_ledger fsl ON fsl.account_id = fsa.id
      WHERE fsa.investor_id = ${input.investorId} AND fsa.status = 'active'
      GROUP BY fsa.id, fsa.opened_at
      HAVING COALESCE(SUM(CASE WHEN fsl.type = 'Deposit' THEN fsl.amount WHEN fsl.type = 'Withdrawal' THEN -fsl.amount ELSE 0 END), 0) >= ${input.amount}
      ORDER BY fsa.opened_at ASC
      LIMIT 1
    `;
    accountId = account.rows[0]?.id ?? null;
    if (!accountId) {
      throw new Error("Withdrawal exceeds available fixed savings balance.");
    }
  }

  const ledger = await sql`
    INSERT INTO fixed_savings_ledger (account_id, investor_id, date, type, amount, annual_rate_percent, notes)
    VALUES (${accountId}, ${input.investorId}, ${input.date}, ${input.type}, ${input.amount}, ${input.annualRatePercent ?? null}, ${input.notes || ""})
    RETURNING id
  `;
  if (input.type === "Withdrawal" && accountId) {
    await sql`
      UPDATE fixed_savings_accounts
      SET status = 'closed'
      WHERE id = ${accountId}
        AND (
          SELECT COALESCE(SUM(CASE WHEN type = 'Deposit' THEN amount WHEN type = 'Withdrawal' THEN -amount ELSE 0 END), 0)
          FROM fixed_savings_ledger
          WHERE account_id = ${accountId}
        ) <= 0
    `;
  }
  await writeAuditEvent("fixed_savings.add", "fixed_savings_ledger", ledger.rows[0].id, {
    accountId,
    investorId: input.investorId,
    type: input.type,
    amount: input.amount,
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
    ORDER BY fsl.date DESC, fsl.created_at DESC
  `;
  return res.rows;
}

export async function getInvestorsWithBalances() {
  await requireAdmin();
  await ensureAuditColumns();
  await ensureInvestorPortalAccessColumns();
  const [res, savings, equityLedger] = await Promise.all([
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
      ),
      investor_units AS (
        SELECT investor_id,
          COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as units
        FROM investor_unit_ledger
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
      SELECT id, account_id, investor_id, type, amount, annual_rate_percent, interest_rate, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `,
    sql`
      SELECT iul.investor_id, iul.type, iul.units, iul.gross_amount, TO_CHAR(iul.date, 'YYYY-MM-DD') as date,
        CASE WHEN bp.id IS NULL THEN false ELSE true END as is_bonus
      FROM investor_unit_ledger iul
      LEFT JOIN bonus_payments bp ON bp.source_id = iul.id AND bp.ledger_type = 'equity'
      ORDER BY iul.date ASC, iul.created_at ASC
    `,
  ]);
  const savingsByInvestor = calculateFixedSavingsLiability(savings.rows as FixedSavingsLedgerRow[]).byInvestor;
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
  const [summary, unitLedger, cash, savings, bonuses, fees] = await Promise.all([
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
      ),
      investor_units AS (
        SELECT COALESCE(SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END), 0) as units
        FROM investor_unit_ledger
        WHERE investor_id = ${investorId}
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
      ORDER BY iul.date DESC, iul.created_at DESC
    `,
    sql`
      SELECT *, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM cash_movements
      WHERE investor_id = ${investorId}
      ORDER BY cash_movements.date DESC, cash_movements.created_at DESC
    `,
    sql`
      SELECT *, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      WHERE investor_id = ${investorId}
      ORDER BY fixed_savings_ledger.date DESC, fixed_savings_ledger.created_at DESC
    `,
    sql`
      SELECT bp.id, bp.ledger_type, bp.amount, TO_CHAR(bp.date, 'YYYY-MM-DD') as date, bp.notes, bp.created_at, bp.audit_status,
        iul.id as source_unit_id
      FROM bonus_payments bp
      LEFT JOIN investor_unit_ledger iul ON iul.id = bp.source_id
      WHERE bp.investor_id = ${investorId}
      ORDER BY bp.date DESC, bp.created_at DESC
    `,
    sql`
      SELECT id, crystallized_gain, fee_rate_percent, fee_amount, TO_CHAR(date, 'YYYY-MM-DD') as date, notes, created_at
      FROM performance_fees
      WHERE investor_id = ${investorId}
        AND audit_status <> 'reverted'
      ORDER BY performance_fees.date DESC, performance_fees.created_at DESC
    `,
  ]);
  const row = summary.rows[0] ?? null;
  const investor = row ? { id: row.id, name: row.name, joined: row.joined } : null;
  if (!investor) return null;

  const savingsSummary = calculateFixedSavingsLiability(savings.rows as FixedSavingsLedgerRow[]);
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
    ...savings.rows
      .filter((movement: any) => movement.type !== "Bonus")
      .map((movement: any) => ({
        id: `savings-${movement.id}`,
        date: movement.date,
        category: "Fixed Savings",
        type: movement.type,
        amount: parseFloat(movement.amount || "0"),
        units: null,
        navPerUnit: null,
        notes: movement.notes,
        auditStatus: movement.audit_status,
        createdAt: movement.created_at,
      })),
    ...bonuses.rows
      .filter((bonus: any) => bonus.ledger_type !== "equity" || !bonus.source_unit_id)
      .map((bonus: any) => ({
        id: `bonus-${bonus.id}`,
        date: bonus.date,
        category: bonus.ledger_type === "equity" ? "Equity Bonus" : "Fixed Savings Bonus",
        type: "Bonus",
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

export async function getInvestorStatementByPortalAccessId(portalAccessId: string) {
  const result = await sql`
    SELECT id
    FROM investors
    WHERE portal_access_id = ${portalAccessId}
    LIMIT 1
  `;
  const investorId = result.rows[0]?.id;
  return investorId ? getInvestorStatement(investorId) : null;
}

export async function getFundSummaryMetrics() {
  await requireAdmin();
  await ensureAuditColumns();
  const [summary, savings] = await Promise.all([
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
      ),
      fees AS (
        SELECT COALESCE(SUM(fee_amount), 0) as total
        FROM performance_fees
        WHERE audit_status <> 'reverted'
      )
      SELECT
        (SELECT row_to_json(latest_nav) FROM latest_nav) as latest_nav,
        (SELECT total_units FROM fund_units) as total_units,
        (SELECT total FROM fees) as performance_fees
    `,
    sql`
      SELECT id, account_id, investor_id, type, amount, annual_rate_percent, interest_rate, TO_CHAR(date, 'YYYY-MM-DD') as date
      FROM fixed_savings_ledger
      ORDER BY fixed_savings_ledger.date ASC, fixed_savings_ledger.created_at ASC
    `,
  ]);
  const row = summary.rows[0] ?? {};
  const latestNav = row.latest_nav ?? null;
  const fixedSavings = calculateFixedSavingsLiability(savings.rows as FixedSavingsLedgerRow[]);

  return {
    latestNav,
    totalUnits: roundUnits(parseFloat(row.total_units || "0")),
    fixedSavingsLiability: fixedSavings.totalLiability,
    fixedSavingsPrincipal: fixedSavings.principal,
    fixedSavingsInterest: fixedSavings.payableInterest,
    performanceFees: roundMoney(parseFloat(row.performance_fees || "0")),
    aum: latestNav ? roundMoney(parseFloat(latestNav.net_asset_value)) : 0,
  };
}

export async function getDashboardSummary() {
  await requireAdmin();
  const [summary, investors] = await Promise.all([
    getFundSummaryMetrics(),
    getInvestorsWithBalances(),
  ]);
  return {
    ...summary,
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
  const tables = await existingResettableTables();
  if (tables.length > 0) {
    await sql.query(`DROP TABLE ${tables.join(", ")} CASCADE`);
  }
}

export async function seedDummyData() {
  await dropAllFundTables();
  await initializeFreshFundDatabase();

  const alice = await sql`INSERT INTO investors (name) VALUES ('Alice Tan') RETURNING id`;
  const ben = await sql`INSERT INTO investors (name) VALUES ('Ben Lim') RETURNING id`;
  const chandra = await sql`INSERT INTO investors (name) VALUES ('Chandra Kumar') RETURNING id`;

  await createNavWeek({
    weekEnding: "2026-05-01",
    platformSnapshots: [],
    adjustments: 0,
    notes: "Bootstrap NAV",
  });
  const week1 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-05-01'`;
  await lockNavWeek(week1.rows[0].id);
  await recordCashMovement({ investorId: alice.rows[0].id, date: "2026-05-04", type: "Deposit", amount: 60000, notes: "Initial subscription" });
  await recordCashMovement({ investorId: ben.rows[0].id, date: "2026-05-04", type: "Deposit", amount: 40000, notes: "Initial subscription" });

  await createNavWeek({
    weekEnding: "2026-05-08",
    platformSnapshots: [],
    adjustments: 112000,
    notes: "Trading gain week",
  });
  const week2 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-05-08'`;
  await lockNavWeek(week2.rows[0].id);
  await recordCashMovement({ investorId: chandra.rows[0].id, date: "2026-05-11", type: "Deposit", amount: 28000, notes: "Late subscription at locked NAV" });

  await createNavWeek({
    weekEnding: "2026-05-15",
    platformSnapshots: [],
    adjustments: 142000,
    notes: "Loss adjustment and fees accrued",
  });
  const week3 = await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-05-15'`;
  await lockNavWeek(week3.rows[0].id);
  await recordCashMovement({ investorId: ben.rows[0].id, date: "2026-05-18", type: "Withdrawal", amount: 12000, notes: "Partial redemption" });
  await recordFixedSavings({ investorId: alice.rows[0].id, date: "2026-05-04", type: "Deposit", amount: 15000, annualRatePercent: 3.65, notes: "Fixed savings placement" });

  await sql`
    INSERT INTO performance_fees (investor_id, nav_week_id, crystallized_gain, fee_rate_percent, fee_amount, date, notes)
    VALUES (${ben.rows[0].id}, ${week3.rows[0].id}, 2000, 20, 400, '2026-05-18', 'Dummy crystallized performance fee')
  `;
  await writeAuditEvent("development.seed", "database", null, { seed: "weekly-unit-nav" });
}
