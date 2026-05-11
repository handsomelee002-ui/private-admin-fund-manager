"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateBrokerageFeeRate } from "@/actions/settings";
import { Check, Pencil } from "lucide-react";

export function BrokerageFeeConfig({ initialRate }: { initialRate: number }) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate]       = useState(initialRate.toString());
  const [loading, setLoading] = useState(false);
  const [saved, setSaved]     = useState(false);

  async function handleSave() {
    setLoading(true);
    const fd = new FormData();
    fd.set("brokerage_fee_pct", rate);
    const res = await updateBrokerageFeeRate(fd);
    setLoading(false);
    if (res?.success) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      alert(res?.error || "Failed to save.");
    }
  }

  return (
    <div className="flex items-center gap-3">
      {editing ? (
        <>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-24 h-9 text-center text-lg font-bold"
            />
            <span className="text-lg font-bold text-muted-foreground">%</span>
          </div>
          <Button size="sm" onClick={handleSave} disabled={loading} className="gap-1.5">
            <Check className="h-3.5 w-3.5" />
            {loading ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setRate(initialRate.toString()); }}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span className="text-4xl font-bold text-primary tabular-nums">
            {parseFloat(rate).toFixed(2)}%
          </span>
          <button
            onClick={() => setEditing(true)}
            className="h-8 w-8 rounded-full border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {saved && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </>
      )}
    </div>
  );
}
