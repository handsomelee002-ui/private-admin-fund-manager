"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revertAuditLog } from "@/actions/adminLogs";

export function RevertAuditLogButton({ id, disabled, compact = false }: { id: string; disabled?: boolean; compact?: boolean }) {
  const [loading, setLoading] = useState(false);

  async function handleRevert() {
    if (!confirm("Revert this transaction by creating a compensating reversal record?")) return;
    setLoading(true);
    const result = await revertAuditLog(id);
    setLoading(false);
    if (result?.error) alert(result.error);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon-sm" : "sm"}
      className={compact ? "" : "h-8 gap-2"}
      onClick={handleRevert}
      disabled={disabled || loading}
      title="Revert transaction"
      aria-label="Revert transaction"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      {compact ? null : loading ? "Reverting" : "Revert"}
    </Button>
  );
}
