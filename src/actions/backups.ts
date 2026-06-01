"use server";

import { createClient, sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { assertAdminPassword, requireAdmin } from "@/lib/auth";
import {
  BACKUP_APP_NAME,
  BACKUP_BASE_CURRENCY,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  assertBackupTableName,
  restoreTableOrder,
  truncateTableOrder,
  type BackupTableName,
} from "@/lib/backupTables";
import {
  createBackupPreview,
  parseBackupJson,
  validateBackupReferences,
  type FundBackupFile,
} from "@/lib/backupValidation";
import { ensureAuditColumns, writeAuditEvent } from "@/lib/fundDb";

const RESTORE_CONFIRMATION = "IMPORT BACKUP";
const MAX_BACKUP_BYTES = 15 * 1024 * 1024;

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteTableName(tableName: string) {
  assertBackupTableName(tableName);
  return quoteIdentifier(tableName);
}

async function existingBackupTables() {
  const existing: BackupTableName[] = [];
  for (const tableName of BACKUP_TABLES) {
    const result = await sql`SELECT to_regclass(${tableName}) as table_name`;
    if (result.rows[0]?.table_name) existing.push(tableName);
  }
  return existing;
}

function assertRestoreTablesExist(existingTables: BackupTableName[], backupTables: Record<BackupTableName, unknown[]>) {
  const existing = new Set(existingTables);
  for (const tableName of BACKUP_TABLES) {
    if (!existing.has(tableName) && backupTables[tableName].length > 0) {
      throw new Error(`Database table ${tableName} does not exist. Initialize the database schema before restore.`);
    }
  }
}

export async function exportFundBackup(formData: FormData) {
  await requireAdmin();
  assertAdminPassword(formData.get("admin_password")?.toString());
  await ensureAuditColumns();

  const existingTables = await existingBackupTables();
  const tables = {} as Record<BackupTableName, Array<Record<string, unknown>>>;
  const rowCounts = {} as Record<BackupTableName, number>;

  for (const tableName of BACKUP_TABLES) {
    tables[tableName] = [];
    rowCounts[tableName] = 0;
  }

  for (const tableName of existingTables) {
    const result = await sql.query(`SELECT * FROM ${quoteTableName(tableName)} ORDER BY 1`);
    tables[tableName] = result.rows;
    rowCounts[tableName] = result.rows.length;
  }

  await writeAuditEvent("backup.export", "database_backup", null, {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    rowCounts,
  });

  return {
    fileName: `fund-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`,
    json: JSON.stringify(
      {
        metadata: {
          app: BACKUP_APP_NAME,
          schemaVersion: BACKUP_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          baseCurrency: BACKUP_BASE_CURRENCY,
          tableOrder: [...BACKUP_TABLES],
          rowCounts,
        },
        tables,
      },
      null,
      2,
    ),
  };
}

export async function previewFundBackupImport(formData: FormData) {
  await requireAdmin();
  try {
    assertAdminPassword(formData.get("admin_password")?.toString());
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Admin password is invalid." };
  }

  const file = formData.get("backup_file");
  if (!(file instanceof File)) return { error: "Backup file is required." };
  if (!file.name.endsWith(".json")) return { error: "Backup file must be a JSON file." };
  if (file.size > MAX_BACKUP_BYTES) return { error: "Backup file is too large." };

  try {
    const raw = await file.text();
    const backup = parseBackupJson(raw);
    validateBackupReferences(backup);
    return { success: true, preview: createBackupPreview(backup), raw };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Backup validation failed." };
  }
}

export async function restoreFundBackup(formData: FormData) {
  await requireAdmin();
  try {
    assertAdminPassword(formData.get("admin_password")?.toString());
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Admin password is invalid." };
  }
  await ensureAuditColumns();

  const confirmation = formData.get("confirmation")?.toString();
  const raw = formData.get("backup_json")?.toString();

  if (confirmation !== RESTORE_CONFIRMATION) return { error: `Type ${RESTORE_CONFIRMATION} to restore.` };
  if (!raw) return { error: "Validated backup payload is required." };

  let backup: FundBackupFile | null = null;
  let existingTables: BackupTableName[] = [];
  try {
    backup = parseBackupJson(raw);
    validateBackupReferences(backup);
    existingTables = await existingBackupTables();
    assertRestoreTablesExist(existingTables, backup.tables);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Backup validation failed." };
  }
  if (!backup) return { error: "Backup validation failed." };

  const client = createClient();
  let committed = false;

  try {
    await client.connect();
    await client.query("BEGIN");

    for (const tableName of truncateTableOrder()) {
      if (existingTables.includes(tableName)) {
        await client.query(`TRUNCATE TABLE ${quoteTableName(tableName)} RESTART IDENTITY CASCADE`);
      }
    }

    for (const tableName of restoreTableOrder()) {
      if (!existingTables.includes(tableName)) continue;

      for (const row of backup.tables[tableName]) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;

        const columnSql = columns.map(quoteIdentifier).join(", ");
        const placeholderSql = columns.map((_, index) => `$${index + 1}`).join(", ");

        await client.query(
          `INSERT INTO ${quoteTableName(tableName)} (${columnSql}) VALUES (${placeholderSql})`,
          columns.map((column) => row[column]),
        );
      }
    }

    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    if (!committed) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original restore error is more useful than a rollback failure.
      }
    }
    return { error: error instanceof Error ? error.message : "Failed to restore backup." };
  } finally {
    try {
      await client.end();
    } catch {
      // Nothing useful can be recovered for the user after the restore result is known.
    }
  }

  let warning: string | undefined;
  try {
    await ensureAuditColumns();
    await writeAuditEvent("backup.restore", "database_backup", null, {
      schemaVersion: backup.metadata.schemaVersion,
      exportedAt: backup.metadata.exportedAt,
      rowCounts: backup.metadata.rowCounts,
    });
  } catch {
    warning = "Backup restored, but the restore audit event could not be written.";
  }

  revalidatePath("/");
  revalidatePath("/brokerage");
  revalidatePath("/settings");
  revalidatePath("/investors");
  revalidatePath("/nav");
  revalidatePath("/trading");
  revalidatePath("/admin-logs");

  return { success: true, warning };
}
