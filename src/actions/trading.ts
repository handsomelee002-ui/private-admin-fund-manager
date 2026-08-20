"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { assertNotFutureDate, calculateFixedSavingsLiability, ensureAuditColumns, getFixedSavingsRateInputs, withTransaction, writeAuditEvent } from "@/lib/fundDb";
import { isRedirectError, requireAdmin } from "@/lib/auth";
import {
  BASE_CURRENCY,
  isRecordableTransactionType,
  percentage,
} from "@/lib/investmentAccounting";
import { roundMoney } from "@/lib/accounting";
import { STALE_AFTER_DAYS, daysBetween } from "@/lib/platformValuation";
import { calculatePlatformPerformance } from "@/lib/platformPerformance";

const ACCOUNT_TYPES = ["BANK", "WALLET", "BROKER_CASH", "BROKER_PORTFOLIO", "OTHER"] as const;
const STATUSES = ["PENDING", "SETTLED", "CANCELLED"] as const;
const FUNDING_SOURCES = ["equity", "fixed_savings", "brokerage"] as const;
type FundingSource = (typeof FUNDING_SOURCES)[number];
type AllocationInput = { fundingSource: FundingSource; ratioPercent: number; baseAmount: number };
let tradingSchemaPromise: Promise<void> | null = null;

function parseNumber(value: FormDataEntryValue | null, label: string, fallback = 0) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`);
  return parsed;
}

function parsePositive(value: FormDataEntryValue | null, label: string, fallback = 0) {
  const parsed = parseNumber(value, label, fallback);
  if (parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function normalizeCurrency(value: FormDataEntryValue | null, fallback = BASE_CURRENCY) {
  const currency = value?.toString().trim().toUpperCase() || fallback;
  if (!/^[A-Z0-9]{3,10}$/.test(currency)) throw new Error("Currency code must be 3 to 10 alphanumeric characters.");
  return currency;
}

function cashFlowAmount(type: string, baseAmount: number) {
  if (["BROKER_DEPOSIT", "Deposit"].includes(type)) return roundMoney(baseAmount);
  if (["BROKER_WITHDRAWAL", "Withdraw"].includes(type)) return roundMoney(-baseAmount);
  return 0;
}

function sourceLabel(source: FundingSource) {
  if (source === "fixed_savings") return "Fixed Savings";
  if (source === "brokerage") return "Brokerage";
  return "Equity";
}

function buildAllocationsFromRatios(cashFlow: number, ratios: Record<FundingSource, number>) {
  const totalRatio = roundMoney(FUNDING_SOURCES.reduce((sum, source) => sum + ratios[source], 0));
  if (Math.abs(totalRatio - 100) > 0.01) throw new Error("Allocation percentages must total 100%.");

  let allocated = 0;
  return FUNDING_SOURCES.map((fundingSource, index) => {
    const baseAmount = index === FUNDING_SOURCES.length - 1
      ? roundMoney(cashFlow - allocated)
      : roundMoney(cashFlow * (ratios[fundingSource] / 100));
    allocated = roundMoney(allocated + baseAmount);
    return { fundingSource, ratioPercent: roundMoney(ratios[fundingSource]), baseAmount };
  }).filter((allocation) => Math.abs(allocation.baseAmount) > 0.001);
}

function buildRatiosFromBalances(balances: Record<FundingSource, number>) {
  const total = roundMoney(FUNDING_SOURCES.reduce((sum, source) => sum + Math.max(0, balances[source] || 0), 0));
  if (total <= 0) throw new Error("No available capital found for automatic allocation.");

  let allocated = 0;
  return FUNDING_SOURCES.reduce((ratios, source, index) => {
    const ratio = index === FUNDING_SOURCES.length - 1
      ? roundMoney(100 - allocated)
      : roundMoney((Math.max(0, balances[source] || 0) / total) * 100);
    allocated = roundMoney(allocated + ratio);
    ratios[source] = ratio;
    return ratios;
  }, {} as Record<FundingSource, number>);
}

function primaryFundingSource(allocations: AllocationInput[]) {
  return allocations.reduce(
    (largest, allocation) => (Math.abs(allocation.baseAmount) > Math.abs(largest.baseAmount) ? allocation : largest),
    allocations[0],
  )?.fundingSource || "equity";
}

function defaultNetAmount(type: string, amount: number, feeAmount: number, taxAmount: number) {
  if (type === "BUY") return roundMoney(amount + feeAmount + taxAmount);
  if (type === "SELL") return roundMoney(amount - feeAmount - taxAmount);
  return roundMoney(amount);
}

function revalidateTrading(platformId?: string) {
  revalidatePath("/trading");
  revalidatePath("/nav");
  revalidatePath("/");
  revalidatePath("/reports");
  if (platformId) revalidatePath(`/trading/${platformId}`);
}

async function ensureTradingSchemaUncached() {
  await requireAdmin();
  await ensureAuditColumns();
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
    )
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
    )
  `;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES platform_accounts(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE platform_transactions ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'equity'`;
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
}

export async function ensureTradingSchema() {
  if (tradingSchemaPromise) return tradingSchemaPromise;
  tradingSchemaPromise = ensureTradingSchemaUncached().catch((error) => {
    tradingSchemaPromise = null;
    throw error;
  });
  return tradingSchemaPromise;
}

export async function getPlatforms() {
  await requireAdmin();
  await ensureTradingSchema();

  const data = await sql`
    WITH latest_platform_snapshot AS (
      SELECT platform_id, unrealized_profit, total_value, equity_net_invested, fixed_savings_net_invested, brokerage_net_invested, brokerage_profit_loss
      FROM (
        SELECT nwps.platform_id, nwps.unrealized_profit, nwps.total_value, nwps.equity_net_invested, nwps.fixed_savings_net_invested, nwps.brokerage_net_invested, nwps.brokerage_profit_loss,
               ROW_NUMBER() OVER(PARTITION BY nwps.platform_id ORDER BY nw.week_ending DESC) as rn
        FROM nav_week_platform_snapshots nwps
        JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
        WHERE nw.status = 'locked'
      ) sub
      WHERE rn = 1
    ),
    transaction_flows AS (
      SELECT
        pt.id,
        pt.platform_id,
        pt.type,
        pt.status,
        pt.audit_status,
        pt.realized_profit,
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
      p.name,
      p.base_currency,
      p.default_currency,
      TO_CHAR(p.created_at, 'YYYY-MM-DD') as created_at,
      TO_CHAR(lv.as_of_date, 'YYYY-MM-DD') as latest_valuation_date,
      lv.total_value as latest_valuation_value,
      COALESCE(lps.unrealized_profit, 0) as unrealized_profit,
      COALESCE(lps.total_value, 0) as latest_total_value,
      COALESCE(lps.brokerage_profit_loss, 0) as brokerage_profit_loss,
      COALESCE(SUM(tf.cash_flow), 0) as net_invested,
      COALESCE(SUM(tf.equity_cash_flow), 0) as equity_net_invested,
      COALESCE(SUM(tf.fixed_savings_cash_flow), 0) as fixed_savings_net_invested,
      COALESCE(SUM(tf.brokerage_cash_flow), 0) as brokerage_net_invested,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(tf.audit_status, 'active') <> 'active' OR COALESCE(tf.status, 'SETTLED') <> 'SETTLED' THEN 0
          ELSE COALESCE(tf.realized_profit, 0)
        END
      ), 0) as realized_profit,
      COALESCE(SUM(tf.cash_flow), 0) as rm_cash_flow
    FROM platforms p
    LEFT JOIN transaction_flows tf ON p.id = tf.platform_id
    LEFT JOIN latest_platform_snapshot lps ON lps.platform_id = p.id
    LEFT JOIN LATERAL (
      SELECT as_of_date, total_value
      FROM platform_valuations
      WHERE platform_id = p.id AND audit_status = 'active'
      ORDER BY as_of_date DESC
      LIMIT 1
    ) lv ON TRUE
    GROUP BY p.id, p.name, p.base_currency, p.default_currency, p.created_at,
      lv.as_of_date, lv.total_value, lps.unrealized_profit, lps.total_value, lps.brokerage_profit_loss
    ORDER BY p.created_at DESC, p.name ASC
  `;

  const today = new Date().toISOString().slice(0, 10);

  return data.rows.map((row: any) => {
    const netInvested = parseFloat(row.net_invested || "0");
    const equityNetInvested = parseFloat(row.equity_net_invested || "0");
    const fixedSavingsNetInvested = parseFloat(row.fixed_savings_net_invested || "0");
    const brokerageNetInvested = parseFloat(row.brokerage_net_invested || "0");
    const realizedProfit = parseFloat(row.realized_profit || "0");
    const unrealizedProfit = parseFloat(row.unrealized_profit || "0");
    const latestTotalValue = parseFloat(row.latest_total_value || "0");
    const latestValuationValue = row.latest_valuation_value === null || row.latest_valuation_value === undefined
      ? null
      : parseFloat(row.latest_valuation_value);
    // A recorded valuation is more current than the last locked NAV snapshot.
    const totalValue = latestValuationValue !== null
      ? latestValuationValue
      : latestTotalValue > 0
        ? latestTotalValue
        : netInvested + unrealizedProfit;
    const simpleRoi = percentage(totalValue - Math.max(netInvested, 0), Math.max(netInvested, 0));
    return {
      id: row.id,
      name: row.name,
      baseCurrency: row.base_currency,
      defaultCurrency: row.default_currency,
      createdAt: row.created_at,
      latestValuationDate: row.latest_valuation_date as string | null,
      latestValuationValue,
      valuationAgeDays: row.latest_valuation_date
        ? daysBetween(row.latest_valuation_date, today)
        : null,
      isValuationStale:
        !row.latest_valuation_date || daysBetween(row.latest_valuation_date, today) > STALE_AFTER_DAYS,
      netInvested,
      equityNetInvested,
      fixedSavingsNetInvested,
      brokerageNetInvested,
      realizedProfit,
      unrealizedProfit,
      brokerageProfitLoss: parseFloat(row.brokerage_profit_loss || "0"),
      totalValue,
      simpleRoi,
    };
  });
}

/**
 * Cash each pool still has available to deploy into a platform.
 *
 * The brokerage pot is charged with *cumulative* interest and bonuses, not
 * outstanding ones: an obligation already paid in cash has left the bank, so
 * treating it as no longer owed would hand the same money back to the pot
 * twice. Fixed-savings bonuses are charged once - they reach the pot through
 * the fixed-savings liability - which is what previously double-counted them.
 */
async function getCapitalAllocationBasis() {
  const [summary, savings, deployed, rateInput] = await Promise.all([
    sql`
      WITH latest_nav AS (
        SELECT id, net_asset_value, equity_fund_cash
        FROM nav_weeks
        WHERE status = 'locked'
        ORDER BY week_ending DESC
        LIMIT 1
      ),
      fees AS (
        SELECT COALESCE(SUM(fee_amount), 0) as total
        FROM performance_fees
        WHERE audit_status <> 'reverted'
      )
      SELECT
        COALESCE((SELECT equity_fund_cash FROM latest_nav), 0) as equity_fund_cash,
        (SELECT id FROM latest_nav) as latest_nav_id,
        COALESCE((SELECT total FROM fees), 0) as performance_fees,
        COALESCE((
          SELECT SUM(amount) FROM bonus_payments
          WHERE audit_status = 'active' AND ledger_type = 'equity'
        ), 0) as equity_bonuses,
        COALESCE((
          SELECT SUM(amount) FROM bonus_payments
          WHERE audit_status = 'active' AND ledger_type = 'fixed_savings'
        ), 0) as fixed_savings_bonuses,
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
    getPlatformSourceBalances(),
    getFixedSavingsRateInputs(),
  ]);

  const fixedSavings = calculateFixedSavingsLiability(savings.rows as any[], undefined, rateInput);
  const row = summary.rows[0] ?? {};
  const brokerageBalance = roundMoney(
    parseFloat(row.brokerage_profit_loss || "0")
      + parseFloat(row.performance_fees || "0")
      - fixedSavings.totalAccruedInterest
      - parseFloat(row.fixed_savings_bonuses || "0")
      - parseFloat(row.equity_bonuses || "0"),
  );

  return {
    // equity_fund_cash is already net of what equity has deployed, so unlike
    // the other two it must not have `deployed` subtracted again.
    equity: Math.max(0, roundMoney(parseFloat(row.equity_fund_cash || "0"))),
    fixed_savings: Math.max(0, roundMoney(fixedSavings.totalLiability - deployed.fixed_savings)),
    brokerage: Math.max(0, roundMoney(brokerageBalance - deployed.brokerage)),
  } satisfies Record<FundingSource, number>;
}

async function getPlatformSourceBalances(platformId?: string) {
  const data = await sql`
    SELECT
      COALESCE(SUM(CASE
        WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
        WHEN pta.id IS NOT NULL AND pta.funding_source = 'equity' THEN pta.base_amount
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'equity' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'equity' AND pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        ELSE 0
      END), 0) as equity,
      COALESCE(SUM(CASE
        WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
        WHEN pta.id IS NOT NULL AND pta.funding_source = 'fixed_savings' THEN pta.base_amount
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'fixed_savings' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'fixed_savings' AND pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        ELSE 0
      END), 0) as fixed_savings,
      COALESCE(SUM(CASE
        WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
        WHEN pta.id IS NOT NULL AND pta.funding_source = 'brokerage' THEN pta.base_amount
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'brokerage' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'brokerage' AND pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        ELSE 0
      END), 0) as brokerage
    FROM platform_transactions pt
    LEFT JOIN platform_transaction_allocations pta ON pta.transaction_id = pt.id
    WHERE (${platformId ?? null}::uuid IS NULL OR pt.platform_id = ${platformId ?? null})
  `;
  const row = data.rows[0] ?? {};
  return {
    equity: roundMoney(parseFloat(row.equity || "0")),
    fixed_savings: roundMoney(parseFloat(row.fixed_savings || "0")),
    brokerage: roundMoney(parseFloat(row.brokerage || "0")),
  } satisfies Record<FundingSource, number>;
}

/**
 * Gross amounts put into a platform per funding source, ignoring withdrawals.
 * Once net invested is exhausted this is what decides who owns the money still
 * coming out.
 */
async function getPlatformContributions(platformId: string) {
  const data = await sql`
    SELECT
      COALESCE(SUM(CASE
        WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
        WHEN pta.id IS NOT NULL AND pta.funding_source = 'equity' AND pta.base_amount > 0 THEN pta.base_amount
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'equity' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        ELSE 0
      END), 0) as equity,
      COALESCE(SUM(CASE
        WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
        WHEN pta.id IS NOT NULL AND pta.funding_source = 'fixed_savings' AND pta.base_amount > 0 THEN pta.base_amount
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'fixed_savings' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        ELSE 0
      END), 0) as fixed_savings,
      COALESCE(SUM(CASE
        WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
        WHEN pta.id IS NOT NULL AND pta.funding_source = 'brokerage' AND pta.base_amount > 0 THEN pta.base_amount
        WHEN pta.id IS NULL AND COALESCE(pt.funding_source, 'equity') = 'brokerage' AND pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
        ELSE 0
      END), 0) as brokerage
    FROM platform_transactions pt
    LEFT JOIN platform_transaction_allocations pta ON pta.transaction_id = pt.id
    WHERE pt.platform_id = ${platformId}
  `;
  const row = data.rows[0] ?? {};
  return {
    equity: roundMoney(parseFloat(row.equity || "0")),
    fixed_savings: roundMoney(parseFloat(row.fixed_savings || "0")),
    brokerage: roundMoney(parseFloat(row.brokerage || "0")),
  } satisfies Record<FundingSource, number>;
}

/**
 * How much may be taken out of a platform, and how it splits across funding
 * sources.
 *
 * The ceiling is what the platform is currently worth, not what was put in.
 * Capping at net invested makes it impossible to record cashing out a dividend
 * or a gain, which is money that genuinely left the platform.
 */
async function getPlatformWithdrawalBasis(platformId: string, asOfDate: string) {
  const [balances, contributions, valuation] = await Promise.all([
    getPlatformSourceBalances(platformId),
    getPlatformContributions(platformId),
    // The mark in force on the transaction's own date, not today's. A backdated
    // withdrawal validated against a later mark could take out a gain the
    // platform had not made yet.
    sql`
      SELECT total_value, TO_CHAR(as_of_date, 'YYYY-MM-DD') as as_of_date
      FROM platform_valuations
      WHERE platform_id = ${platformId} AND audit_status = 'active'
        AND as_of_date <= ${asOfDate}
      ORDER BY as_of_date DESC
      LIMIT 1
    `,
  ]);

  const netTotal = roundMoney(FUNDING_SOURCES.reduce((sum, source) => sum + Math.max(0, balances[source] || 0), 0));
  const contributedTotal = roundMoney(
    FUNDING_SOURCES.reduce((sum, source) => sum + Math.max(0, contributions[source] || 0), 0),
  );
  const latestValue = valuation.rows[0] ? roundMoney(parseFloat(valuation.rows[0].total_value || "0")) : null;

  let cap: number;
  if (latestValue === null) {
    // Never valued: the only defensible ceiling is what was put in.
    cap = Math.max(0, netTotal);
  } else {
    // The value mark is a snapshot. Money that moved in or out since then has
    // not been re-marked, so apply it to the mark; otherwise the same profit
    // could be withdrawn twice.
    const since = await sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END
      ), 0) as delta
      FROM platform_transactions pt
      WHERE pt.platform_id = ${platformId}
        AND COALESCE(pt.audit_status, 'active') = 'active'
        AND COALESCE(pt.status, 'SETTLED') = 'SETTLED'
        AND pt.date > ${valuation.rows[0].as_of_date}
        AND pt.date <= ${asOfDate}
    `;
    cap = Math.max(0, roundMoney(latestValue + parseFloat(since.rows[0]?.delta || "0")));
  }
  // Split by capital still in the platform while there is any; once principal
  // is fully withdrawn, by who funded it.
  const basis = netTotal > 0 ? balances : contributedTotal > 0 ? contributions : balances;
  const basisTotal = netTotal > 0 ? netTotal : contributedTotal;

  const sourceCaps = FUNDING_SOURCES.reduce(
    (caps, source) => {
      caps[source] = basisTotal > 0 ? roundMoney(cap * (Math.max(0, basis[source] || 0) / basisTotal)) : 0;
      return caps;
    },
    {} as Record<FundingSource, number>,
  );

  return { cap, basis, sourceCaps, latestValue };
}

export async function getPlatformCapitalAllocation(platformId: string) {
  await requireAdmin();
  await ensureTradingSchema();
  const [platformBalances, automaticBasis] = await Promise.all([
    getPlatformSourceBalances(platformId),
    getCapitalAllocationBasis(),
  ]);
  const total = roundMoney(FUNDING_SOURCES.reduce((sum, source) => sum + platformBalances[source], 0));
  return {
    automaticBasis,
    platformBalances,
    platformAllocations: FUNDING_SOURCES.map((source) => ({
      source,
      label: sourceLabel(source),
      baseAmount: platformBalances[source],
      ratioPercent: total > 0 ? roundMoney((platformBalances[source] / total) * 100) : 0,
    })),
  };
}

export async function getPlatform(id: string) {
  await requireAdmin();
  await ensureTradingSchema();
  const data = await sql`
    SELECT id, name, base_currency, default_currency, TO_CHAR(created_at, 'YYYY-MM-DD') as created_at
    FROM platforms
    WHERE id = ${id}
  `;
  return data.rows[0] ?? null;
}

export async function getPlatformAccounts(platformId: string) {
  await requireAdmin();
  await ensureTradingSchema();
  const data = await sql`
    SELECT id, platform_id, name, account_type, currency, TO_CHAR(created_at, 'YYYY-MM-DD') as created_at
    FROM platform_accounts
    WHERE platform_id = ${platformId}
    ORDER BY currency ASC, name ASC
  `;
  return data.rows;
}

export async function getPlatformAssets(platformId: string) {
  await requireAdmin();
  await ensureTradingSchema();
  const data = await sql`
    SELECT id, platform_id, symbol, name, asset_type, currency, latest_price, latest_fx_rate_to_myr
    FROM platform_assets
    WHERE platform_id = ${platformId}
    ORDER BY symbol ASC, currency ASC
  `;
  return data.rows;
}

export async function addPlatform(formData: FormData) {
  await requireAdmin();
  await ensureTradingSchema();
  const name = formData.get("name")?.toString()?.trim();
  const defaultCurrency = normalizeCurrency(formData.get("default_currency"));
  if (!name) return { error: "Platform name is required" };

  try {
    const existing = await sql`SELECT id FROM platforms WHERE name = ${name}`;
    if (existing.rows.length > 0) return { error: "A platform with this name already exists." };

    const created = await sql`
      INSERT INTO platforms (name, base_currency, default_currency)
      VALUES (${name}, ${BASE_CURRENCY}, ${defaultCurrency})
      RETURNING id
    `;
    await sql`
      INSERT INTO platform_accounts (platform_id, name, account_type, currency)
      VALUES (${created.rows[0].id}, ${`${name} ${defaultCurrency} Cash`}, 'BROKER_CASH', ${defaultCurrency})
      ON CONFLICT DO NOTHING
    `;
    await writeAuditEvent("platform.add", "platforms", created.rows[0].id, {
      name,
      defaultCurrency,
    });
    revalidateTrading(created.rows[0].id);
    return { success: true, id: created.rows[0].id };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to add platform." };
  }
}

export async function updatePlatformName(formData: FormData) {
  await requireAdmin();
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString()?.trim();
  if (!id || !name) return { error: "ID and new name are required" };

  try {
    await sql`UPDATE platforms SET name = ${name} WHERE id = ${id}`;
    revalidateTrading(id);
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to update platform name." };
  }
}

export async function deletePlatform(id: string) {
  await requireAdmin();
  await ensureTradingSchema();
  if (!id) return { error: "Platform id is required." };

  try {
    const platform = await sql`
      SELECT
        p.id,
        p.name,
        (SELECT COUNT(*)::int FROM platform_transactions pt WHERE pt.platform_id = p.id) as transaction_count,
        (SELECT COUNT(*)::int FROM nav_week_platform_snapshots nwps WHERE nwps.platform_id = p.id) as snapshot_count,
        (SELECT COUNT(*)::int FROM platform_accounts pa WHERE pa.platform_id = p.id) as account_count,
        (SELECT COUNT(*)::int FROM platform_assets passet WHERE passet.platform_id = p.id) as asset_count
      FROM platforms p
      WHERE p.id = ${id}
    `;
    const row = platform.rows[0];
    if (!row) return { error: "Platform not found." };

    const transactionCount = Number(row.transaction_count || 0);
    const snapshotCount = Number(row.snapshot_count || 0);
    if (transactionCount > 0 || snapshotCount > 0) {
      return {
        error: "Only platforms with no transactions and no NAV snapshots can be deleted. Use reversing transactions for platforms with financial history.",
      };
    }

    const deleted = await sql`
      DELETE FROM platforms p
      WHERE p.id = ${id}
        AND NOT EXISTS (SELECT 1 FROM platform_transactions pt WHERE pt.platform_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM nav_week_platform_snapshots nwps WHERE nwps.platform_id = p.id)
      RETURNING p.id
    `;
    if (deleted.rows.length === 0) {
      return { error: "Platform deletion was blocked because financial records now depend on it." };
    }

    await writeAuditEvent("platform.delete", "platforms", id, {
      name: row.name,
      deletedAccounts: Number(row.account_count || 0),
      deletedAssets: Number(row.asset_count || 0),
    });
    revalidateTrading(id);
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to delete platform." };
  }
}

export async function addPlatformAccount(formData: FormData) {
  await requireAdmin();
  await ensureTradingSchema();
  const platformId = formData.get("platform_id")?.toString();
  const name = formData.get("name")?.toString().trim();
  const accountType = formData.get("account_type")?.toString() || "BROKER_CASH";
  const currency = normalizeCurrency(formData.get("currency"));
  if (!platformId || !name) return { error: "Platform, account name, and currency are required." };
  if (!ACCOUNT_TYPES.includes(accountType as (typeof ACCOUNT_TYPES)[number])) return { error: "Invalid account type." };

  try {
    const inserted = await sql`
      INSERT INTO platform_accounts (platform_id, name, account_type, currency)
      VALUES (${platformId}, ${name}, ${accountType}, ${currency})
      RETURNING id
    `;
    await writeAuditEvent("platform_account.add", "platform_accounts", inserted.rows[0].id, { platformId, name, accountType, currency });
    revalidateTrading(platformId);
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to add account." };
  }
}

export async function addPlatformAsset(formData: FormData) {
  await requireAdmin();
  await ensureTradingSchema();
  const platformId = formData.get("platform_id")?.toString();
  const symbol = formData.get("symbol")?.toString().trim().toUpperCase();
  const name = formData.get("name")?.toString().trim() || null;
  const assetType = formData.get("asset_type")?.toString().trim().toUpperCase() || "SECURITY";
  const currency = normalizeCurrency(formData.get("currency"));
  const latestPrice = parseNumber(formData.get("latest_price"), "Latest price");
  const latestFxRateToMyr = parsePositive(formData.get("latest_fx_rate_to_myr"), "Latest FX rate", currency === BASE_CURRENCY ? 1 : 0);
  if (!platformId || !symbol) return { error: "Platform and symbol are required." };

  try {
    const inserted = await sql`
      INSERT INTO platform_assets (platform_id, symbol, name, asset_type, currency, latest_price, latest_fx_rate_to_myr)
      VALUES (${platformId}, ${symbol}, ${name}, ${assetType}, ${currency}, ${latestPrice}, ${latestFxRateToMyr})
      RETURNING id
    `;
    await writeAuditEvent("platform_asset.add", "platform_assets", inserted.rows[0].id, { platformId, symbol, currency });
    revalidateTrading(platformId);
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to add asset." };
  }
}

export async function getPlatformTransactions(platformId: string) {
  await requireAdmin();
  await ensureTradingSchema();
  const data = await sql`
    SELECT
      pt.id,
      pt.platform_id,
      pt.account_id,
      pa.name as account_name,
      pt.asset_id,
      pt.funding_source,
      pt.allocation_method,
      COALESCE(
        json_agg(
          json_build_object(
            'funding_source', pta.funding_source,
            'ratio_percent', pta.ratio_percent,
            'base_amount', pta.base_amount
          )
          ORDER BY pta.funding_source
        ) FILTER (WHERE pta.id IS NOT NULL),
        '[]'::json
      ) as allocations,
      passt.symbol as asset_symbol,
      passt.name as asset_name,
      TO_CHAR(pt.date, 'YYYY-MM-DD') as date,
      pt.type,
      pt.amount,
      pt.currency,
      pt.base_amount,
      pt.fx_rate_to_base,
      pt.from_currency,
      pt.to_currency,
      pt.from_amount,
      pt.to_amount,
      pt.quantity,
      pt.price_per_unit,
      pt.gross_amount,
      pt.fee_amount,
      pt.tax_amount,
      pt.net_amount,
      pt.realized_profit,
      pt.reference,
      pt.status,
      TO_CHAR(pt.settlement_date, 'YYYY-MM-DD') as settlement_date,
      pt.notes,
      pt.audit_status,
      pt.reversal_of_id
    FROM platform_transactions pt
    LEFT JOIN platform_accounts pa ON pa.id = pt.account_id
    LEFT JOIN platform_assets passt ON passt.id = pt.asset_id
    LEFT JOIN platform_transaction_allocations pta ON pta.transaction_id = pt.id
    WHERE pt.platform_id = ${platformId}
    GROUP BY pt.id, pa.name, passt.symbol, passt.name
    ORDER BY pt.date DESC, pt.created_at DESC
  `;
  return data.rows;
}

export async function addPlatformTransaction(formData: FormData) {
  await requireAdmin();
  await ensureTradingSchema();
  const platformId = formData.get("platform_id")?.toString();
  const accountId = formData.get("account_id")?.toString() || null;
  const assetId = formData.get("asset_id")?.toString() || null;
  const allocationMode = formData.get("allocation_mode")?.toString() === "manual" ? "manual" : "automatic";
  const date = formData.get("date")?.toString();
  const type = formData.get("type")?.toString() || "";
  const currency = normalizeCurrency(formData.get("currency"));
  const submittedBaseAmount = formData.get("base_amount");
  const submittedAmount = formData.get("amount");
  const hasBaseAmount = submittedBaseAmount !== null && submittedBaseAmount !== "";
  const hasAmount = submittedAmount !== null && submittedAmount !== "";
  const enteredBaseAmount = hasBaseAmount ? parsePositive(submittedBaseAmount, "RM amount") : 0;
  const amount = hasAmount ? parsePositive(submittedAmount, "Amount") : enteredBaseAmount;
  const submittedFxRate = formData.get("fx_rate_to_base");
  const fxRateToBase = submittedFxRate
    ? parsePositive(submittedFxRate, "FX rate")
    : hasAmount && hasBaseAmount
      ? enteredBaseAmount / amount
      : currency === BASE_CURRENCY
        ? 1
        : hasBaseAmount
          ? 1
          : 0;
  const baseAmount = hasBaseAmount ? enteredBaseAmount : amount * fxRateToBase;
  // Entering only an RM figure for a foreign-currency transaction used to store
  // that figure as the native amount at a rate of 1, mislabelling ringgit as
  // the foreign currency. Record it as what it is.
  const effectiveCurrency = !hasAmount && hasBaseAmount ? BASE_CURRENCY : currency;
  const feeAmount = parseNumber(formData.get("fee_amount"), "Fee");
  const taxAmount = parseNumber(formData.get("tax_amount"), "Tax");
  const realizedProfit = formData.get("realized_profit") ? parseNumber(formData.get("realized_profit"), "Realized profit") : null;
  const status = formData.get("status")?.toString() || "SETTLED";

  if (!platformId || !date || !isRecordableTransactionType(type)) return { error: "Platform, date, and a valid transaction type are required. Adjustments are no longer recorded because they change no balance." };
  try {
    assertNotFutureDate(date, "Transaction date");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Invalid transaction date." };
  }
  // A locked NAV already priced this period from the platform values of the
  // time. Money moving in or out beneath it changes net invested that the
  // locked NAV was built on, so refuse rather than silently contradict it.
  const lockedBeneath = await sql`
    SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
    FROM nav_weeks
    WHERE status = 'locked' AND week_ending >= ${date}
    ORDER BY week_ending ASC
    LIMIT 1
  `;
  if (lockedBeneath.rows.length > 0) {
    return {
      error: `NAV week ${lockedBeneath.rows[0].week_ending} is locked and already priced this period. Date this transaction after it.`,
    };
  }
  if (!hasBaseAmount && !hasAmount) return { error: "RM amount or native amount is required." };
  if (currency !== BASE_CURRENCY && !hasBaseAmount && fxRateToBase <= 0) return { error: "FX rate is required when only a foreign amount is entered." };
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { error: "Invalid transaction status." };

  const quantity = formData.get("quantity") ? parsePositive(formData.get("quantity"), "Quantity") : null;
  const pricePerUnit = formData.get("price_per_unit") ? parsePositive(formData.get("price_per_unit"), "Price per unit") : null;
  if (["BUY", "SELL"].includes(type) && (!assetId || !quantity || !pricePerUnit)) {
    return { error: "Trades require asset, quantity, and price per unit." };
  }

  const fromCurrency = formData.get("from_currency") ? normalizeCurrency(formData.get("from_currency")) : null;
  const toCurrency = formData.get("to_currency") ? normalizeCurrency(formData.get("to_currency")) : null;
  const fromAmount = formData.get("from_amount") ? parsePositive(formData.get("from_amount"), "From amount") : null;
  const toAmount = formData.get("to_amount") ? parsePositive(formData.get("to_amount"), "To amount") : null;
  if (type === "FX_CONVERSION" && (!fromCurrency || !toCurrency || !fromAmount || !toAmount)) {
    return { error: "FX conversion requires from currency, to currency, from amount, and to amount." };
  }

  const grossAmount = formData.get("gross_amount") ? parseNumber(formData.get("gross_amount"), "Gross amount") : amount;
  const netAmount = formData.get("net_amount") ? parseNumber(formData.get("net_amount"), "Net amount") : defaultNetAmount(type, amount, feeAmount, taxAmount);
  const reference = formData.get("reference")?.toString().trim() || null;
  const settlementDate = formData.get("settlement_date")?.toString() || null;
  const notes = formData.get("notes")?.toString() || "";
  const cashFlow = cashFlowAmount(type, baseAmount);
  let allocations: AllocationInput[] = [];

  try {
    if (cashFlow !== 0) {
      const moneyIn = cashFlow > 0;
      const withdrawal = moneyIn ? null : await getPlatformWithdrawalBasis(platformId, date);
      const basis = moneyIn ? await getCapitalAllocationBasis() : withdrawal!.basis;
      const totalCap = moneyIn
        ? roundMoney(FUNDING_SOURCES.reduce((sum, source) => sum + Math.max(0, basis[source] || 0), 0))
        : withdrawal!.cap;
      const sourceCaps = moneyIn ? basis : withdrawal!.sourceCaps;

      if (Math.abs(cashFlow) > totalCap + 0.001) {
        return {
          error: moneyIn
            ? "Transaction amount exceeds available capital balance."
            : withdrawal!.latestValue === null
              ? `Money out of RM ${Math.abs(cashFlow).toFixed(2)} exceeds the RM ${totalCap.toFixed(2)} put into this platform. Record what the platform is worth first if you are taking out a gain.`
              : `Money out of RM ${Math.abs(cashFlow).toFixed(2)} exceeds this platform's recorded value of RM ${totalCap.toFixed(2)}. Update its value first if the platform has grown.`,
        };
      }
      if (allocationMode === "manual") {
        const ratios = {
          equity: parseNumber(formData.get("allocation_equity_pct"), "Equity allocation"),
          fixed_savings: parseNumber(formData.get("allocation_fixed_savings_pct"), "Fixed savings allocation"),
          brokerage: parseNumber(formData.get("allocation_brokerage_pct"), "Brokerage allocation"),
        } satisfies Record<FundingSource, number>;
        if (FUNDING_SOURCES.some((source) => ratios[source] < 0)) return { error: "Allocation percentages cannot be negative." };
        allocations = buildAllocationsFromRatios(cashFlow, ratios);
        const exceededSource = allocations.find((allocation) => Math.abs(allocation.baseAmount) > Math.max(0, sourceCaps[allocation.fundingSource]) + 0.001);
        if (exceededSource) {
          return { error: `${sourceLabel(exceededSource.fundingSource)} allocation exceeds available balance.` };
        }
      } else {
        allocations = buildAllocationsFromRatios(cashFlow, buildRatiosFromBalances(basis));
      }
    }
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to allocate transaction." };
  }
  const fundingSource = allocations.length > 0 ? primaryFundingSource(allocations) : "equity";

  try {
    // The transaction and its funding allocations must land together. A
    // transaction left with no allocation rows falls back to its single
    // funding_source column, which silently attributes the whole amount to one
    // pool and corrupts every balance derived from it.
    await withTransaction(async (db) => {
      const inserted = await db`
        INSERT INTO platform_transactions (
          platform_id, account_id, asset_id, funding_source, date, type, amount, currency, base_currency, base_amount,
          fx_rate_to_base, from_currency, to_currency, from_amount, to_amount, quantity, price_per_unit,
          gross_amount, fee_amount, tax_amount, net_amount, realized_profit, reference, status, settlement_date, notes,
          allocation_method
        )
        VALUES (
          ${platformId}, ${accountId}, ${assetId}, ${fundingSource}, ${date}, ${type}, ${amount}, ${effectiveCurrency}, ${BASE_CURRENCY}, ${baseAmount},
          ${fxRateToBase}, ${fromCurrency}, ${toCurrency}, ${fromAmount}, ${toAmount}, ${quantity}, ${pricePerUnit},
          ${grossAmount}, ${feeAmount}, ${taxAmount}, ${netAmount}, ${realizedProfit}, ${reference}, ${status}, ${settlementDate}, ${notes},
          ${allocations.length > 0 ? allocationMode : "none"}
        )
        RETURNING id
      `;
      for (const allocation of allocations) {
        await db`
          INSERT INTO platform_transaction_allocations (transaction_id, funding_source, ratio_percent, base_amount)
          VALUES (${inserted.rows[0].id}, ${allocation.fundingSource}, ${allocation.ratioPercent}, ${allocation.baseAmount})
        `;
      }
      await writeAuditEvent("platform_transaction.add", "platform_transactions", inserted.rows[0].id, {
        platformId,
        accountId,
        assetId,
        fundingSource,
        allocationMode: allocations.length > 0 ? allocationMode : "none",
        allocations,
        type,
        amount,
        currency: effectiveCurrency,
        baseAmount,
        fxRateToBase,
        status,
      }, db);
    });
    revalidateTrading(platformId);
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to add transaction." };
  }
}

export async function deletePlatformTransaction(_id: string) {
  await requireAdmin();
  void _id;
  return { error: "Financial transactions cannot be deleted. Use Admin Logs revert instead." };
}

export async function getPlatformNavSnapshots(platformId: string) {
  await requireAdmin();
  const data = await sql`
    SELECT
      nwps.id,
      nwps.platform_id,
      TO_CHAR(nw.week_ending, 'YYYY-MM-DD') as week_ending,
      nwps.net_invested,
      nwps.unrealized_profit,
      nwps.total_value,
      nwps.equity_net_invested,
      nwps.fixed_savings_net_invested,
      nwps.brokerage_net_invested,
      nwps.equity_unrealized_profit,
      nwps.brokerage_profit_loss,
      nw.nav_per_unit,
      nw.status
    FROM nav_week_platform_snapshots nwps
    JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
    WHERE nwps.platform_id = ${platformId}
      AND nw.status = 'locked'
    ORDER BY nw.week_ending DESC
  `;
  return data.rows;
}

export async function getPlatformPerformance(platformId: string) {
  await requireAdmin();
  const [transactions, snapshots] = await Promise.all([
    getPlatformTransactions(platformId),
    getPlatformNavSnapshots(platformId),
  ]);
  return calculatePlatformPerformance(transactions, snapshots);
}
