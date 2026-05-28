"use client";

import { useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { exportFundBackup, previewFundBackupImport, restoreFundBackup } from "@/actions/backups";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BackupPreview = {
  exportedAt: string;
  schemaVersion: number;
  tableCounts: Record<string, number>;
  totalRows: number;
};

type BackupManagerProps = {
  adminPassword: string;
  onProtectedActionSuccess: () => void;
};

export function BackupManager({ adminPassword, onProtectedActionSuccess }: BackupManagerProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [backupJson, setBackupJson] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState<"export" | "preview" | "restore" | null>(null);

  async function downloadBackup() {
    setError(null);
    setSuccess(null);
    setLoading("export");

    try {
      const formData = new FormData();
      formData.set("admin_password", adminPassword);
      const result = await exportFundBackup(formData);
      const blob = new Blob([result.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onProtectedActionSuccess();
      setSuccess("Backup exported.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to export backup.");
    } finally {
      setLoading(null);
    }
  }

  async function previewImport(formData: FormData) {
    setError(null);
    setSuccess(null);
    setPreview(null);
    setBackupJson("");
    setConfirmation("");
    setLoading("preview");

    try {
      const result = await previewFundBackupImport(formData);
      if ("error" in result) {
        setError(result.error ?? "Failed to validate backup.");
        return;
      }
      setPreview(result.preview);
      setBackupJson(result.raw);
      onProtectedActionSuccess();
      setSuccess("Backup validated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to validate backup.");
    } finally {
      setLoading(null);
    }
  }

  async function restoreImport() {
    setError(null);
    setSuccess(null);
    setLoading("restore");

    const formData = new FormData();
    formData.set("backup_json", backupJson);
    formData.set("confirmation", confirmation);
    formData.set("admin_password", adminPassword);

    try {
      const result = await restoreFundBackup(formData);
      if ("error" in result) {
        setError(result.error ?? "Failed to restore backup.");
        return;
      }
      setSuccess(result.warning ?? "Backup restored.");
      setPreview(null);
      setBackupJson("");
      setConfirmation("");
      onProtectedActionSuccess();
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to restore backup.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50 shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base">Manual Database Backup</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Backup files contain full financial records, investor names, locked NAV snapshots, and audit logs.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Export backup</p>
            <p className="text-xs text-muted-foreground">Download a plain JSON restore file for the current database.</p>
          </div>
          <Button type="button" onClick={downloadBackup} disabled={loading !== null}>
            <Download className="h-4 w-4" />
            {loading === "export" ? "Exporting" : "Export JSON"}
          </Button>
        </div>

        <form action={previewImport} className="space-y-3 border-t border-border/50 pt-5">
          <div className="space-y-1.5">
            <Label htmlFor="backup_file">Import backup</Label>
            <Input id="backup_file" name="backup_file" type="file" accept="application/json,.json" required />
            <p className="text-xs text-muted-foreground">Validation runs before any database change.</p>
          </div>
          <input type="hidden" name="admin_password" value={adminPassword} />
          <Button type="submit" variant="outline" disabled={loading !== null}>
            <Upload className="h-4 w-4" />
            {loading === "preview" ? "Validating" : "Validate Backup"}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-emerald-500">{success}</p>}

        {preview && (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div>
              <p className="text-sm font-medium">Validated backup</p>
              <p className="text-xs text-muted-foreground">
                Exported {new Date(preview.exportedAt).toLocaleString()} with {preview.totalRows} rows.
              </p>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(preview.tableCounts).map(([tableName, count]) => (
                <div key={tableName} className="flex justify-between gap-3 rounded-md border border-border/50 px-2 py-1">
                  <span className="truncate">{tableName}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="backup_confirmation">Type IMPORT BACKUP to replace the current database</Label>
              <Input
                id="backup_confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={restoreImport}
              disabled={loading !== null || confirmation !== "IMPORT BACKUP"}
            >
              {loading === "restore" ? "Restoring" : "Restore Backup"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
