import {
  BACKUP_APP_NAME,
  BACKUP_BASE_CURRENCY,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLE_ORDER_BY_VERSION,
  BACKUP_TABLES,
  IGNORED_LEGACY_TABLES,
  SUPPORTED_BACKUP_SCHEMA_VERSIONS,
  TABLES_MISSING_IN_VERSION,
  type BackupTableName,
} from "@/lib/backupTables";

type BackupPrimitive = string | number | boolean | null;
type BackupJson = BackupPrimitive | BackupJson[] | { [key: string]: BackupJson };
type BackupRow = Record<string, BackupJson>;

export type FundBackupFile = {
  metadata: {
    app: typeof BACKUP_APP_NAME;
    schemaVersion: typeof BACKUP_SCHEMA_VERSION;
    exportedAt: string;
    baseCurrency: typeof BACKUP_BASE_CURRENCY;
    tableOrder: BackupTableName[];
    rowCounts: Record<BackupTableName, number>;
  };
  tables: Record<BackupTableName, BackupRow[]>;
};

export type BackupPreview = {
  exportedAt: string;
  schemaVersion: number;
  tableCounts: Record<BackupTableName, number>;
  totalRows: number;
};

const BACKUP_TABLE_COLUMN_ALLOWLIST: Record<BackupTableName, readonly string[]> = {
  investors: ["id", "name", "portal_access_id", "portal_access_rotated_at", "created_at"],
  fund_config: ["key", "value", "updated_at"],
  platforms: ["id", "name", "base_currency", "default_currency", "created_at"],
  platform_accounts: ["id", "platform_id", "name", "account_type", "currency", "created_at"],
  platform_assets: ["id", "platform_id", "symbol", "name", "asset_type", "currency", "latest_price", "latest_fx_rate_to_myr", "updated_at", "created_at"],
  nav_weeks: ["id", "week_ending", "settlement_date", "gross_assets", "fund_cash", "liabilities", "adjustments", "net_asset_value", "total_units", "nav_per_unit", "status", "locked_at", "notes", "created_at"],
  nav_week_platform_snapshots: [
    "id", "nav_week_id", "platform_id", "net_invested", "unrealized_profit", "total_value", "equity_net_invested",
    "fixed_savings_net_invested", "brokerage_net_invested", "equity_unrealized_profit", "brokerage_profit_loss", "created_at",
    "valuation_date", "valuation_source", "valuation_age_days", "weight_percent",
  ],
  investor_unit_ledger: ["id", "investor_id", "nav_week_id", "date", "type", "units", "nav_per_unit", "gross_amount", "notes", "created_at", "audit_status", "reversal_of_id"],
  cash_movements: ["id", "investor_id", "nav_week_id", "unit_ledger_id", "date", "type", "amount", "status", "notes", "created_at", "audit_status", "reversal_of_id"],
  fixed_savings_base_rates: ["id", "effective_date", "annual_rate_percent", "created_at"],
  fixed_savings_promotions: ["id", "name", "start_date", "end_date", "annual_rate_percent", "balance_cap", "status", "notes", "created_at"],
  fixed_savings_accounts: ["id", "investor_id", "opened_at", "annual_rate_percent", "status", "created_at"],
  fixed_savings_ledger: ["id", "account_id", "investor_id", "withdrawal_batch_id", "date", "type", "amount", "annual_rate_percent", "interest_rate", "notes", "created_at", "audit_status", "reversal_of_id"],
  performance_fees: ["id", "investor_id", "nav_week_id", "crystallized_gain", "fee_rate_percent", "fee_amount", "date", "notes", "created_at", "audit_status", "reversal_of_id"],
  bonus_payments: ["id", "investor_id", "ledger_type", "source_id", "amount", "date", "notes", "created_at", "audit_status", "reversal_of_id"],
  investor_profit_claims: ["id", "investor_id", "locked_amount", "settled_amount", "brokerage_fee", "status", "claim_date", "settled_date", "notes", "created_at"],
  capital_ledger: ["id", "investor_id", "date", "type", "amount", "notes", "receipt_url", "created_at"],
  platform_transactions: [
    "id", "platform_id", "date", "type", "amount", "realized_profit", "notes", "created_at", "account_id", "asset_id", "currency", "base_currency",
    "base_amount", "fx_rate_to_base", "from_currency", "to_currency", "from_amount", "to_amount", "quantity", "price_per_unit", "gross_amount",
    "fee_amount", "tax_amount", "net_amount", "reference", "status", "settlement_date", "funding_source", "audit_status", "reversal_of_id",
    "allocation_method",
  ],
  platform_transaction_allocations: ["id", "transaction_id", "funding_source", "ratio_percent", "base_amount", "created_at"],
  platform_valuations: ["id", "platform_id", "as_of_date", "total_value", "source", "notes", "audit_status", "reversal_of_id", "created_at"],
  fund_cash_valuations: ["id", "as_of_date", "balance", "notes", "audit_status", "reversal_of_id", "created_at"],
  trading_ledger: ["id", "date", "platform", "ticker", "type", "currency", "price", "quantity", "amount_rm", "profit_loss", "date_closed", "receipt_url", "created_at"],
  audit_events: ["id", "actor_id", "action", "entity_type", "entity_id", "details", "created_at", "reason"],
};

const BACKUP_ENUMS: Partial<Record<BackupTableName, Record<string, readonly string[]>>> = {
  nav_weeks: { status: ["draft", "locked"] },
  investor_unit_ledger: { type: ["UnitIssue", "UnitRedemption"], audit_status: ["active", "reverted", "reversal"] },
  cash_movements: { type: ["Deposit", "Withdrawal"], status: ["pending", "settled", "rejected"], audit_status: ["active", "reverted", "reversal"] },
  fixed_savings_promotions: { status: ["active", "disabled"] },
  fixed_savings_accounts: { status: ["active", "closed"] },
  fixed_savings_ledger: { type: ["Deposit", "Withdrawal", "Bonus", "InterestWithdrawal"], audit_status: ["active", "reverted", "reversal"] },
  bonus_payments: { ledger_type: ["equity", "fixed_savings"], audit_status: ["active", "reverted", "reversal"] },
  investor_profit_claims: { status: ["pending", "partial", "settled"] },
  platform_accounts: { account_type: ["BANK", "WALLET", "BROKER_CASH", "BROKER_PORTFOLIO", "OTHER"] },
  platform_valuations: {
    source: ["MANUAL", "STATEMENT", "IMPORT"],
    audit_status: ["active", "reverted", "reversal"],
  },
  fund_cash_valuations: { audit_status: ["active", "reverted", "reversal"] },
  platform_transaction_allocations: { funding_source: ["equity", "fixed_savings", "brokerage"] },
  platform_transactions: {
    // Only BROKER_DEPOSIT/BROKER_WITHDRAWAL are recordable now, but historical
    // rows carrying the older per-trade types must still restore.
    type: ["TRANSFER", "FX_CONVERSION", "BROKER_DEPOSIT", "BROKER_WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "INTEREST", "FEE", "TAX", "CORPORATE_ACTION", "ADJUSTMENT", "Deposit", "Withdraw"],
    status: ["PENDING", "SETTLED", "CANCELLED"],
    funding_source: ["equity", "fixed_savings", "brokerage"],
    audit_status: ["active", "reverted", "reversal"],
    allocation_method: ["legacy", "none", "manual", "automatic"],
  },
};

const NUMERIC_COLUMN_PATTERN = /(^amount$|_amount$|^gross_assets$|^liabilities$|^adjustments$|^net_asset_value$|^total_units$|^nav_per_unit$|^units$|percent$|rate|price|quantity|profit|balance|fee|tax)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPrimitive(value: unknown, fieldName: string): asserts value is BackupPrimitive {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  throw new Error(`Backup contains unsupported value at ${fieldName}.`);
}

function assertJsonValue(value: unknown, fieldName: string): asserts value is BackupJson {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${fieldName}.${index}`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${fieldName}.${key}`);
    }
    return;
  }
  throw new Error(`Backup contains unsupported value at ${fieldName}.`);
}

function assertValidExportDate(exportedAt: unknown): asserts exportedAt is string {
  if (typeof exportedAt !== "string" || Number.isNaN(Date.parse(exportedAt))) {
    throw new Error("Backup export date is invalid.");
  }
}

function parseBackupRows(tableName: BackupTableName, rows: unknown): BackupRow[] {
  if (!Array.isArray(rows)) throw new Error(`Backup table ${tableName} must be an array.`);
  const allowedColumns = new Set(BACKUP_TABLE_COLUMN_ALLOWLIST[tableName]);
  const enumColumns = BACKUP_ENUMS[tableName] ?? {};

  return rows.map((row, rowIndex) => {
    if (!isRecord(row)) throw new Error(`Backup table ${tableName} has an invalid row.`);
    const parsedRow: BackupRow = {};
    for (const [columnName, value] of Object.entries(row)) {
      if (!allowedColumns.has(columnName)) {
        throw new Error(`Backup table ${tableName} contains unsupported column ${columnName}.`);
      }
      if (columnName === "details") {
        assertJsonValue(value, `${tableName}.${rowIndex}.${columnName}`);
      } else {
        assertPrimitive(value, `${tableName}.${rowIndex}.${columnName}`);
      }
      const enumValues = enumColumns[columnName];
      if (enumValues && value !== null && !enumValues.includes(String(value))) {
        throw new Error(`Backup table ${tableName} contains invalid ${columnName}.`);
      }
      if (value !== null && NUMERIC_COLUMN_PATTERN.test(columnName)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          throw new Error(`Backup table ${tableName} contains invalid numeric value at ${columnName}.`);
        }
      }
      parsedRow[columnName] = value;
    }
    return parsedRow;
  });
}

export function parseBackupJson(raw: string): FundBackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }

  if (!isRecord(parsed) || !isRecord(parsed.metadata) || !isRecord(parsed.tables)) {
    throw new Error("Backup file structure is invalid.");
  }

  const metadata = parsed.metadata;
  if (metadata.app !== BACKUP_APP_NAME) throw new Error("Backup belongs to a different application.");
  const fileVersion = metadata.schemaVersion;
  if (
    typeof fileVersion !== "number" ||
    !SUPPORTED_BACKUP_SCHEMA_VERSIONS.includes(fileVersion as (typeof SUPPORTED_BACKUP_SCHEMA_VERSIONS)[number])
  ) {
    throw new Error(
      `Backup schema version is not supported. Supported versions: ${SUPPORTED_BACKUP_SCHEMA_VERSIONS.join(", ")}.`,
    );
  }
  if (metadata.baseCurrency !== BACKUP_BASE_CURRENCY) throw new Error("Backup base currency is not supported.");
  const exportedAt = metadata.exportedAt;
  assertValidExportDate(exportedAt);

  const expectedOrder = BACKUP_TABLE_ORDER_BY_VERSION[fileVersion] ?? BACKUP_TABLES;
  if (!Array.isArray(metadata.tableOrder) || metadata.tableOrder.join(",") !== expectedOrder.join(",")) {
    throw new Error("Backup table order does not match this application version.");
  }

  if (!isRecord(metadata.rowCounts)) throw new Error("Backup row counts are invalid.");

  const tables = {} as Record<BackupTableName, BackupRow[]>;
  const rowCounts = {} as Record<BackupTableName, number>;
  const absentTables = new Set(TABLES_MISSING_IN_VERSION[fileVersion] ?? []);

  for (const tableName of BACKUP_TABLES) {
    // Tables introduced after this backup was written restore as empty.
    if (absentTables.has(tableName)) {
      tables[tableName] = [];
      rowCounts[tableName] = 0;
      continue;
    }
    const count = metadata.rowCounts[tableName];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`Backup row count for ${tableName} is invalid.`);
    }
    const rows = parseBackupRows(tableName, parsed.tables[tableName] ?? []);
    if (rows.length !== count) throw new Error(`Backup row count mismatch for ${tableName}.`);
    tables[tableName] = rows;
    rowCounts[tableName] = count;
  }

  // Older exports carried platform_performance (never created by any
  // migration) and cash_balances (written but never read). Both are dropped.
  void IGNORED_LEGACY_TABLES;

  return {
    metadata: {
      app: BACKUP_APP_NAME,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt,
      baseCurrency: BACKUP_BASE_CURRENCY,
      tableOrder: [...BACKUP_TABLES],
      rowCounts,
    },
    tables,
  };
}

export function createBackupPreview(backup: FundBackupFile): BackupPreview {
  const tableCounts = BACKUP_TABLES.reduce(
    (counts, tableName) => {
      counts[tableName] = backup.tables[tableName].length;
      return counts;
    },
    {} as Record<BackupTableName, number>,
  );

  return {
    exportedAt: backup.metadata.exportedAt,
    schemaVersion: backup.metadata.schemaVersion,
    tableCounts,
    totalRows: Object.values(tableCounts).reduce((sum, count) => sum + count, 0),
  };
}

export function validateBackupReferences(backup: FundBackupFile) {
  const ids = (tableName: BackupTableName) =>
    new Set(backup.tables[tableName].map((row) => row.id).filter((id): id is string => typeof id === "string"));

  const investorIds = ids("investors");
  const navWeekIds = ids("nav_weeks");
  const platformIds = ids("platforms");
  const platformAccountIds = ids("platform_accounts");
  const platformAssetIds = ids("platform_assets");
  const fixedSavingsAccountIds = ids("fixed_savings_accounts");

  for (const row of backup.tables.platform_accounts) {
    if (typeof row.platform_id === "string" && !platformIds.has(row.platform_id)) {
      throw new Error("Backup has a platform account with a missing platform.");
    }
  }

  for (const row of backup.tables.platform_assets) {
    if (typeof row.platform_id === "string" && !platformIds.has(row.platform_id)) {
      throw new Error("Backup has a platform asset with a missing platform.");
    }
  }

  for (const row of backup.tables.cash_movements) {
    if (typeof row.investor_id === "string" && !investorIds.has(row.investor_id)) {
      throw new Error("Backup has a cash movement with a missing investor.");
    }
    if (typeof row.nav_week_id === "string" && !navWeekIds.has(row.nav_week_id)) {
      throw new Error("Backup has a cash movement with a missing NAV week.");
    }
  }

  for (const row of backup.tables.investor_unit_ledger) {
    if (typeof row.investor_id === "string" && !investorIds.has(row.investor_id)) {
      throw new Error("Backup has a unit ledger row with a missing investor.");
    }
    if (typeof row.nav_week_id === "string" && !navWeekIds.has(row.nav_week_id)) {
      throw new Error("Backup has a unit ledger row with a missing NAV week.");
    }
  }

  for (const row of backup.tables.fixed_savings_accounts) {
    if (typeof row.investor_id === "string" && !investorIds.has(row.investor_id)) {
      throw new Error("Backup has a fixed savings account with a missing investor.");
    }
  }

  for (const row of backup.tables.fixed_savings_ledger) {
    if (typeof row.investor_id === "string" && !investorIds.has(row.investor_id)) {
      throw new Error("Backup has a fixed savings ledger row with a missing investor.");
    }
    if (typeof row.account_id === "string" && !fixedSavingsAccountIds.has(row.account_id)) {
      throw new Error("Backup has a fixed savings ledger row with a missing account.");
    }
  }

  for (const row of backup.tables.performance_fees) {
    if (typeof row.investor_id === "string" && !investorIds.has(row.investor_id)) {
      throw new Error("Backup has a performance fee with a missing investor.");
    }
    if (typeof row.nav_week_id === "string" && !navWeekIds.has(row.nav_week_id)) {
      throw new Error("Backup has a performance fee with a missing NAV week.");
    }
  }

  for (const row of backup.tables.capital_ledger) {
    if (typeof row.investor_id === "string" && !investorIds.has(row.investor_id)) {
      throw new Error("Backup has a capital ledger row with a missing investor.");
    }
  }

  for (const row of backup.tables.investor_profit_claims) {
    if (typeof row.investor_id === "string" && !investorIds.has(row.investor_id)) {
      throw new Error("Backup has an investor profit claim with a missing investor.");
    }
  }

  for (const row of backup.tables.platform_transactions) {
    if (typeof row.platform_id === "string" && !platformIds.has(row.platform_id)) {
      throw new Error("Backup has a platform transaction with a missing platform.");
    }
    if (typeof row.account_id === "string" && !platformAccountIds.has(row.account_id)) {
      throw new Error("Backup has a platform transaction with a missing account.");
    }
    if (typeof row.asset_id === "string" && !platformAssetIds.has(row.asset_id)) {
      throw new Error("Backup has a platform transaction with a missing asset.");
    }
  }

  for (const row of backup.tables.nav_week_platform_snapshots) {
    if (typeof row.nav_week_id === "string" && !navWeekIds.has(row.nav_week_id)) {
      throw new Error("Backup has a platform snapshot with a missing NAV week.");
    }
    if (typeof row.platform_id === "string" && !platformIds.has(row.platform_id)) {
      throw new Error("Backup has a platform snapshot with a missing platform.");
    }
  }
}
