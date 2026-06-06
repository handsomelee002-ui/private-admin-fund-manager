export const BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_APP_NAME = "private-admin-fund-manager";
export const BACKUP_BASE_CURRENCY = "MYR";

export const BACKUP_TABLES = [
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
