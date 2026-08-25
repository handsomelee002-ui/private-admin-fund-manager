export const BACKUP_SCHEMA_VERSION = 6;

// Older backups predate tables added since. They restore fine — the missing
// tables simply come back empty — so keep accepting them rather than stranding
// existing backup files. v6 adds no table, only brokerage_withdrawals.type,
// which defaults to CASH; every row a v5 backup holds was cash, so restoring one
// is correct without a backfill and needs no entry below.
export const SUPPORTED_BACKUP_SCHEMA_VERSIONS = [2, 3, 4, 5, 6] as const;

// Exact table order each schema version wrote, so an older backup still
// validates against the order it was exported with.
export const BACKUP_TABLE_ORDER_BY_VERSION: Record<number, readonly string[]> = {
  2: [
    "investors",
    "fund_config",
    "platforms",
    "platform_accounts",
    "platform_assets",
    "nav_weeks",
    "nav_week_platform_snapshots",
    "investor_unit_ledger",
    "cash_movements",
    "fixed_savings_base_rates",
    "fixed_savings_promotions",
    "fixed_savings_accounts",
    "fixed_savings_ledger",
    "performance_fees",
    "bonus_payments",
    "investor_profit_claims",
    "capital_ledger",
    "platform_transactions",
    "platform_performance",
    "trading_ledger",
    "cash_balances",
    "audit_events",
  ],
  4: [
    "investors",
    "fund_config",
    "platforms",
    "platform_accounts",
    "platform_assets",
    "platform_valuations",
    "fund_cash_valuations",
    "nav_weeks",
    "nav_week_platform_snapshots",
    "investor_unit_ledger",
    "cash_movements",
    "fixed_savings_base_rates",
    "fixed_savings_promotions",
    "fixed_savings_accounts",
    "fixed_savings_ledger",
    "performance_fees",
    "bonus_payments",
    "investor_profit_claims",
    "capital_ledger",
    "platform_transactions",
    "platform_transaction_allocations",
    "trading_ledger",
    "audit_events",
  ],
  3: [
    "investors",
    "fund_config",
    "platforms",
    "platform_accounts",
    "platform_assets",
    "platform_valuations",
    "nav_weeks",
    "nav_week_platform_snapshots",
    "investor_unit_ledger",
    "cash_movements",
    "fixed_savings_base_rates",
    "fixed_savings_promotions",
    "fixed_savings_accounts",
    "fixed_savings_ledger",
    "performance_fees",
    "bonus_payments",
    "investor_profit_claims",
    "capital_ledger",
    "platform_transactions",
    "platform_transaction_allocations",
    "trading_ledger",
    "cash_balances",
    "audit_events",
  ],
};

// Tables a given schema version did not have. Restoring an older backup must
// not fail merely because these keys are absent, and v2's platform_performance
// was never actually created by any migration, so it is ignored on restore.
export const TABLES_MISSING_IN_VERSION: Record<number, readonly string[]> = {
  2: ["platform_valuations", "platform_transaction_allocations", "fund_cash_valuations", "brokerage_withdrawals"],
  3: ["fund_cash_valuations", "brokerage_withdrawals"],
  4: ["brokerage_withdrawals"],
};

// platform_performance was never created by any migration, and cash_balances
// was written but never read before fund_cash_valuations replaced it.
export const IGNORED_LEGACY_TABLES = ["platform_performance", "cash_balances"] as const;
export const BACKUP_APP_NAME = "private-admin-fund-manager";
export const BACKUP_BASE_CURRENCY = "MYR";

export const BACKUP_TABLES = [
  "investors",
  "fund_config",
  "platforms",
  "platform_accounts",
  "platform_assets",
  "platform_valuations",
  "fund_cash_valuations",
  "nav_weeks",
  "nav_week_platform_snapshots",
  "investor_unit_ledger",
  "cash_movements",
  "fixed_savings_base_rates",
  "fixed_savings_promotions",
  "fixed_savings_accounts",
  "fixed_savings_ledger",
  "performance_fees",
  "bonus_payments",
  "investor_profit_claims",
  "capital_ledger",
  "platform_transactions",
  "platform_transaction_allocations",
  "trading_ledger",
  "brokerage_withdrawals",
  "audit_events",
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export function assertBackupTableName(tableName: string): asserts tableName is BackupTableName {
  if (!BACKUP_TABLES.includes(tableName as BackupTableName)) {
    throw new Error(`Refusing to access unapproved backup table: ${tableName}`);
  }
}

export function restoreTableOrder() {
  return [...BACKUP_TABLES];
}

export function truncateTableOrder() {
  return [...BACKUP_TABLES].reverse();
}
