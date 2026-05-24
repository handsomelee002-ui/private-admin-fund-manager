"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revertAuditLog } from "@/actions/adminLogs";

export function RevertAuditLogButton({ id, disabled }: { id: string; disabled?: boolean }) {
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
      size="sm"
      className="h-8 gap-2"
      onClick={handleRevert}
      disabled={disabled || loading}
    >
      <RotateCcw className="h-3.5 w-3.5" />
      {loading ? "Reverting" : "Revert"}
    </Button>
  );
}
