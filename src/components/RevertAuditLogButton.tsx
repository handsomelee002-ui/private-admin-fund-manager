"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revertAuditLog } from "@/actions/adminLogs";
import { useIsViewer } from "@/components/RoleContext";

export function RevertAuditLogButton({
  id,
  disabled,
  disabledReason,
  compact = false,
}: {
  id: string;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  async function handleRevert() {
    if (!confirm("Revert this transaction by creating a compensating reversal record?")) return;
    setLoading(true);
    const result = await revertAuditLog(id);
    setLoading(false);
    if (result?.error) alert(result.error);
  }

  const viewerLocked = useIsViewer();
  if (viewerLocked) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon-sm" : "sm"}
      className={compact ? "" : "h-8 gap-2"}
      onClick={handleRevert}
      disabled={disabled || loading}
      title={disabled && disabledReason ? disabledReason : "Revert transaction"}
      aria-label={disabled && disabledReason ? disabledReason : "Revert transaction"}
    >
      <RotateCcw className="h-3.5 w-3.5" />
      {compact ? null : loading ? "Reverting" : "Revert"}
    </Button>
  );
}
