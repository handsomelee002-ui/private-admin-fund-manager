"use client";

import { useState } from "react";
import { lockNavWeekAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

export function LockNavButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  async function lock() {
    if (!confirm("Lock this NAV week? Deposits and withdrawals can settle against it after locking.")) return;
    const formData = new FormData();
    formData.set("id", id);
    setLoading(true);
    const result = await lockNavWeekAction(formData);
    setLoading(false);
    if (result?.error) alert(result.error);
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={lock} disabled={loading} className="gap-2">
      <Lock className="h-3.5 w-3.5" />
      {loading ? "Locking..." : "Lock"}
    </Button>
  );
}
