import {
  BACKUP_APP_NAME,
  BACKUP_BASE_CURRENCY,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  type BackupTableName,
} from "@/lib/backupTables";

type BackupPrimitive = string | number | boolean | null;
type BackupRow = Record<string, BackupPrimitive>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPrimitive(value: unknown, fieldName: string): asserts value is BackupPrimitive {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  throw new Error(`Backup contains unsupported value at ${fieldName}.`);
}

function assertValidExportDate(exportedAt: unknown): asserts exportedAt is string {
  if (typeof exportedAt !== "string" || Number.isNaN(Date.parse(exportedAt))) {
    throw new Error("Backup export date is invalid.");
  }
}

function parseBackupRows(tableName: BackupTableName, rows: unknown): BackupRow[] {
  if (!Array.isArray(rows)) throw new Error(`Backup table ${tableName} must be an array.`);

  return rows.map((row, rowIndex) => {
    if (!isRecord(row)) throw new Error(`Backup table ${tableName} has an invalid row.`);
    const parsedRow: BackupRow = {};
    for (const [columnName, value] of Object.entries(row)) {
      assertPrimitive(value, `${tableName}.${rowIndex}.${columnName}`);
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
  if (metadata.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error("Backup schema version is not supported.");
  if (metadata.baseCurrency !== BACKUP_BASE_CURRENCY) throw new Error("Backup base currency is not supported.");
  const exportedAt = metadata.exportedAt;
  assertValidExportDate(exportedAt);

  if (!Array.isArray(metadata.tableOrder) || metadata.tableOrder.join(",") !== BACKUP_TABLES.join(",")) {
    throw new Error("Backup table order does not match this application version.");
  }

  if (!isRecord(metadata.rowCounts)) throw new Error("Backup row counts are invalid.");

  const tables = {} as Record<BackupTableName, BackupRow[]>;
  const rowCounts = {} as Record<BackupTableName, number>;

  for (const tableName of BACKUP_TABLES) {
    const count = metadata.rowCounts[tableName];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`Backup row count for ${tableName} is invalid.`);
    }
    const rows = parseBackupRows(tableName, parsed.tables[tableName] ?? []);
    if (rows.length !== count) throw new Error(`Backup row count mismatch for ${tableName}.`);
    tables[tableName] = rows;
    rowCounts[tableName] = count;
  }

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
