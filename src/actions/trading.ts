"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { ensureAuditColumns, writeAuditEvent } from "@/lib/fundDb";
import { requireAdmin } from "@/lib/auth";
import {
  BASE_CURRENCY,
  calculateXirr,
  INVESTMENT_TRANSACTION_TYPES,
  isInvestmentTransactionType,
  percentage,
  signedCashFlow,
} from "@/lib/investmentAccounting";

const ACCOUNT_TYPES = ["BANK", "WALLET", "BROKER_CASH", "BROKER_PORTFOLIO", "OTHER"] as const;
const STATUSES = ["PENDING", "SETTLED", "CANCELLED"] as const;

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

function revalidateTrading(platformId?: string) {
  revalidatePath("/trading");
  revalidatePath("/nav");
  revalidatePath("/");
  revalidatePath("/reports");
  if (platformId) revalidatePath(`/trading/${platformId}`);
}

export async function ensureTradingSchema() {
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
}

export async function getPlatforms() {
  await requireAdmin();
  await ensureTradingSchema();

  const data = await sql`
    SELECT
      p.id,
      p.name,
      p.base_currency,
      p.default_currency,
      TO_CHAR(p.created_at, 'YYYY-MM-DD') as created_at,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN pt.type IN ('BROKER_DEPOSIT', 'Deposit') THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN pt.type IN ('BROKER_WITHDRAWAL', 'Withdraw') THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END
      ), 0) as net_invested,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          ELSE COALESCE(pt.realized_profit, 0)
        END
      ), 0) as realized_profit,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(pt.audit_status, 'active') <> 'active' OR COALESCE(pt.status, 'SETTLED') <> 'SETTLED' THEN 0
          WHEN pt.type = 'BROKER_DEPOSIT' THEN COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          WHEN pt.type = 'BROKER_WITHDRAWAL' THEN -COALESCE(NULLIF(pt.base_amount, 0), pt.amount)
          ELSE 0
        END
      ), 0) as rm_cash_flow
    FROM platforms p
    LEFT JOIN platform_transactions pt ON p.id = pt.platform_id
    GROUP BY p.id, p.name, p.base_currency, p.default_currency, p.created_at
    ORDER BY p.created_at DESC, p.name ASC
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
    WHERE rn = 1
  `;

  const latestPerfMap = new Map<string, number>();
  perfData.rows.forEach((row) => latestPerfMap.set(row.platform_id, parseFloat(row.unrealized_profit || "0")));

  return data.rows.map((row: any) => {
    const netInvested = parseFloat(row.net_invested || "0");
    const realizedProfit = parseFloat(row.realized_profit || "0");
    const unrealizedProfit = latestPerfMap.get(row.id) || 0;
    const totalValue = netInvested + unrealizedProfit;
    const simpleRoi = percentage(totalValue - Math.max(netInvested, 0), Math.max(netInvested, 0));
    return {
      id: row.id,
      name: row.name,
      baseCurrency: row.base_currency,
      defaultCurrency: row.default_currency,
      createdAt: row.created_at,
      netInvested,
      realizedProfit,
      unrealizedProfit,
      totalValue,
      simpleRoi,
    };
  });
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
    revalidateTrading(created.rows[0].id);
    return { success: true, id: created.rows[0].id };
  } catch (error) {
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
    return { error: error instanceof Error ? error.message : "Failed to update platform name." };
  }
}

export async function deletePlatform(id: string) {
  await requireAdmin();
  void id;
  return { error: "Platforms cannot be hard-deleted because transaction history depends on them. Disable new activity or use reversing transactions." };
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
    WHERE pt.platform_id = ${platformId}
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
  const feeAmount = parseNumber(formData.get("fee_amount"), "Fee");
  const taxAmount = parseNumber(formData.get("tax_amount"), "Tax");
  const realizedProfit = formData.get("realized_profit") ? parseNumber(formData.get("realized_profit"), "Realized profit") : null;
  const status = formData.get("status")?.toString() || "SETTLED";

  if (!platformId || !date || !isInvestmentTransactionType(type)) return { error: "Platform, date, and valid transaction type are required." };
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
  const netAmount = formData.get("net_amount") ? parseNumber(formData.get("net_amount"), "Net amount") : amount - feeAmount - taxAmount;
  const reference = formData.get("reference")?.toString().trim() || null;
  const settlementDate = formData.get("settlement_date")?.toString() || null;
  const notes = formData.get("notes")?.toString() || "";

  try {
    const inserted = await sql`
      INSERT INTO platform_transactions (
        platform_id, account_id, asset_id, date, type, amount, currency, base_currency, base_amount,
        fx_rate_to_base, from_currency, to_currency, from_amount, to_amount, quantity, price_per_unit,
        gross_amount, fee_amount, tax_amount, net_amount, realized_profit, reference, status, settlement_date, notes
      )
      VALUES (
        ${platformId}, ${accountId}, ${assetId}, ${date}, ${type}, ${amount}, ${currency}, ${BASE_CURRENCY}, ${baseAmount},
        ${fxRateToBase}, ${fromCurrency}, ${toCurrency}, ${fromAmount}, ${toAmount}, ${quantity}, ${pricePerUnit},
        ${grossAmount}, ${feeAmount}, ${taxAmount}, ${netAmount}, ${realizedProfit}, ${reference}, ${status}, ${settlementDate}, ${notes}
      )
      RETURNING id
    `;
    await writeAuditEvent("platform_transaction.add", "platform_transactions", inserted.rows[0].id, {
      platformId,
      accountId,
      assetId,
      type,
      amount,
      currency,
      baseAmount,
      fxRateToBase,
      status,
    });
    revalidateTrading(platformId);
    return { success: true };
  } catch (error) {
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

  const activeSettled = transactions.filter((transaction: any) => transaction.audit_status === "active" && transaction.status === "SETTLED");
  const totalDeposits = activeSettled.reduce((sum: number, transaction: any) => {
    return ["BROKER_DEPOSIT", "Deposit"].includes(transaction.type) ? sum + parseFloat(transaction.base_amount || transaction.amount || "0") : sum;
  }, 0);
  const totalWithdrawals = activeSettled.reduce((sum: number, transaction: any) => {
    return ["BROKER_WITHDRAWAL", "Withdraw"].includes(transaction.type) ? sum + parseFloat(transaction.base_amount || transaction.amount || "0") : sum;
  }, 0);
  const realizedProfit = activeSettled.reduce((sum: number, transaction: any) => sum + parseFloat(transaction.realized_profit || "0"), 0);
  const latestUnrealized = snapshots.length > 0 ? parseFloat(snapshots[0].unrealized_profit || "0") : 0;
  const netInvested = totalDeposits - totalWithdrawals;
  const currentValue = netInvested + latestUnrealized;
  const simpleRoi = percentage(currentValue + totalWithdrawals - totalDeposits, totalDeposits);
  const cashFlows = activeSettled
    .filter((transaction: any) => ["BROKER_DEPOSIT", "BROKER_WITHDRAWAL", "Deposit", "Withdraw"].includes(transaction.type))
    .map((transaction: any) => ({
      date: transaction.date,
      amount: signedCashFlow(transaction.type, parseFloat(transaction.base_amount || transaction.amount || "0")),
    }));
  if (currentValue !== 0) {
    cashFlows.push({ date: new Date().toISOString().slice(0, 10), amount: currentValue });
  }

  return {
    totalDeposits,
    totalWithdrawals,
    netInvested,
    currentValue,
    realizedProfit,
    latestUnrealized,
    simpleRoi,
    xirr: calculateXirr(cashFlows),
    transactionTypes: INVESTMENT_TRANSACTION_TYPES,
  };
}
