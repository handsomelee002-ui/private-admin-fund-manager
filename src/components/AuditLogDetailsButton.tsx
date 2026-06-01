"use client";

import { useState } from "react";
import { FileSearch } from "lucide-react";
import { getAdminAuditLogDetails } from "@/actions/adminLogs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type AuditLogDetails = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string;
  created_at: string;
  details: unknown;
  readableDetails?: Record<string, unknown>;
  canRevert?: boolean;
  has_revert?: boolean;
  revertSupport?: string;
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function titleize(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " / ");
}

function flattenReadableDetails(value: unknown, prefix = ""): { label: string; value: string }[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const label = prefix ? `${prefix} ${titleize(key)}` : titleize(key);
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return flattenReadableDetails(item, label);
    }
    return [{ label, value: formatValue(item) }];
  });
}

export function AuditLogDetailsButton({ log }: { log: AuditLogDetails }) {
  const [detailsLog, setDetailsLog] = useState<AuditLogDetails | null>(log.readableDetails ? log : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeLog = detailsLog ?? log;
  const readableRows = flattenReadableDetails(activeLog.readableDetails);

  async function loadDetails() {
    if (detailsLog || loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = await getAdminAuditLogDetails(log.id);
      if ("error" in result) {
        setError(result.error ?? "Failed to load audit details.");
        return;
      }
      setDetailsLog(result.log);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load audit details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="View audit details"
            aria-label="View audit details"
            onClick={loadDetails}
          />
        }
      >
        <FileSearch className="h-3.5 w-3.5" />
      </DialogTrigger>
      <DialogContent
        className="grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-4"
        style={{
          width: "min(calc(100vw - 2rem), 44rem)",
          height: "min(42rem, calc(100dvh - 6rem))",
          maxWidth: "none",
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Audit Details</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
          <div className="grid gap-2 text-xs">
          <div className="grid gap-2 rounded-md border border-border/50 bg-muted/20 p-3 sm:grid-cols-2">
            <div>
              <div className="text-muted-foreground">Time</div>
              <div className="font-medium">{activeLog.created_at}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Action</div>
              <div className="font-medium">{activeLog.action}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Entity</div>
              <div className="font-medium">{activeLog.entity_type}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Actor</div>
              <div className="font-medium">{activeLog.actor_id}</div>
            </div>
          </div>
          {loading && (
            <div className="rounded-md border border-border/50 bg-muted/20 p-2 text-muted-foreground">
              Loading audit details...
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
              {error}
            </div>
          )}
          <div>
            <div className="mb-1 text-muted-foreground">Revert Support</div>
            <div className="rounded-md border border-border/50 bg-muted/20 p-2">
              {activeLog.revertSupport || "This audit event cannot be reverted."}
            </div>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">Readable Details</div>
            {readableRows.length > 0 ? (
              <div className="grid gap-2 rounded-md border border-border/50 bg-muted/20 p-3">
                {readableRows.map((row) => (
                  <div key={`${row.label}:${row.value}`} className="min-w-0">
                    <div className="truncate text-muted-foreground">{row.label}</div>
                    <div className="break-words font-medium">{row.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-border/50 bg-muted/20 p-2 text-muted-foreground">
                No related readable records were found for this audit event.
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">Entity ID</div>
            <div className="break-all rounded-md border border-border/50 bg-muted/20 p-2 font-mono">
              {activeLog.entity_id || "-"}
            </div>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">Raw Details</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
              {JSON.stringify(activeLog.details ?? {}, null, 2)}
            </pre>
          </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
