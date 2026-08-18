export const BACKUP_SCHEMA_VERSION = 3;

// v2 backups predate platform_valuations and platform_transaction_allocations.
// They restore fine — those tables simply come back empty — so keep accepting
// them rather than stranding existing backup files.
export const SUPPORTED_BACKUP_SCHEMA_VERSIONS = [2, 3] as const;

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
};

// Tables a given schema version did not have. Restoring an older backup must
// not fail merely because these keys are absent, and v2's platform_performance
// was never actually created by any migration, so it is ignored on restore.
export const TABLES_MISSING_IN_VERSION: Record<number, readonly string[]> = {
  2: ["platform_valuations", "platform_transaction_allocations"],
};

export const IGNORED_LEGACY_TABLES = ["platform_performance"] as const;
export const BACKUP_APP_NAME = "private-admin-fund-manager";
export const BACKUP_BASE_CURRENCY = "MYR";

export const BACKUP_TABLES = [
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
