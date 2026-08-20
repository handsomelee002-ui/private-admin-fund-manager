"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { addPlatformTransaction } from "@/actions/trading";

const transactionTypes = [
  { value: "BROKER_DEPOSIT", label: "Money In" },
  { value: "BROKER_WITHDRAWAL", label: "Money Out" },
];

type FundingSource = "equity" | "fixed_savings" | "brokerage";
type SourceBalances = Record<FundingSource, number>;

const sourceMeta: { source: FundingSource; label: string; shortLabel: string; color: string }[] = [
  { source: "equity", label: "Equity", shortLabel: "E", color: "text-blue-400" },
  { source: "fixed_savings", label: "Fixed Savings", shortLabel: "FS", color: "text-amber-400" },
  { source: "brokerage", label: "Brokerage", shortLabel: "B", color: "text-emerald-400" },
];

function formatRm(value: number) {
  return `RM ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ratiosFromBalances(balances: SourceBalances) {
  const total = sourceMeta.reduce((sum, item) => sum + Math.max(0, balances[item.source] || 0), 0);
  if (total <= 0) return { equity: 0, fixed_savings: 0, brokerage: 0 } satisfies SourceBalances;

  let allocated = 0;
  return sourceMeta.reduce((ratios, item, index) => {
    const ratio = index === sourceMeta.length - 1
      ? Math.round((100 - allocated) * 100) / 100
      : Math.round((Math.max(0, balances[item.source] || 0) / total) * 10000) / 100;
    allocated = Math.round((allocated + ratio) * 100) / 100;
    ratios[item.source] = ratio;
    return ratios;
  }, {} as SourceBalances);
}

export function AddPlatformTransactionForm({
  platformId,
  automaticAllocationBasis,
  platformAllocationBalances,
}: {
  platformId: string;
  automaticAllocationBasis: SourceBalances;
  platformAllocationBalances: SourceBalances;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transactionType, setTransactionType] = useState("BROKER_DEPOSIT");
  const [baseAmount, setBaseAmount] = useState("");
  const [manualAllocation, setManualAllocation] = useState(false);
  const [manualRatios, setManualRatios] = useState<SourceBalances>({ equity: 100, fixed_savings: 0, brokerage: 0 });
  const automaticRatios = useMemo(
    () => ratiosFromBalances(transactionType === "BROKER_WITHDRAWAL" ? platformAllocationBalances : automaticAllocationBasis),
    [automaticAllocationBasis, platformAllocationBalances, transactionType],
  );
  const previewRatios = manualAllocation ? manualRatios : automaticRatios;
  const previewAmount = Number(baseAmount) || 0;
  const manualTotal = sourceMeta.reduce((sum, item) => sum + (Number(manualRatios[item.source]) || 0), 0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const formData = new FormData(event.currentTarget);
    formData.append("platform_id", platformId);
    formData.set("status", "SETTLED");
    const result = await addPlatformTransaction(formData);
    setLoading(false);
    if (result?.success) setOpen(false);
    else alert(result?.error || "Failed to save transaction.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 gap-2">
        <Plus className="h-4 w-4" />
        Add Transaction
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
          <DialogTitle>Add Platform Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                name="type"
                required
                value={transactionType}
                onChange={(event) => setTransactionType(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card/50 px-3 text-sm"
              >
                {transactionTypes.map((transactionType) => (
                  <option key={transactionType.value} value={transactionType.value}>{transactionType.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="base_amount">RM Amount</Label>
            <Input
              id="base_amount"
              name="base_amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={baseAmount}
              onChange={(event) => setBaseAmount(event.target.value)}
              placeholder="Final RM cost or RM received"
            />
          </div>

          <div className="space-y-3 rounded-md border border-border/50 bg-muted/20 p-3">
            <input type="hidden" name="allocation_mode" value={manualAllocation ? "manual" : "automatic"} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Allocation Preview</p>
                <p className="text-xs text-muted-foreground">
                  {manualAllocation ? "Manual override for this transaction." : "Automatic proportional allocation."}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={manualAllocation}
                  onChange={(event) => setManualAllocation(event.target.checked)}
                  className="h-4 w-4"
                />
                Advanced override
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {sourceMeta.map((item) => {
                const ratio = Number(previewRatios[item.source]) || 0;
                return (
                  <div key={item.source} className="rounded-md border border-border/50 bg-background/40 p-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className={`font-semibold ${item.color}`}>{ratio.toFixed(2)}%</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold">{formatRm(previewAmount * (ratio / 100))}</p>
                  </div>
                );
              })}
            </div>

            {manualAllocation && (

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {sourceMeta.map((item) => (
                  <div key={item.source} className="space-y-1">
                    <Label htmlFor={`allocation_${item.source}_pct`}>{item.label} %</Label>
                    <Input
                      id={`allocation_${item.source}_pct`}
                      name={`allocation_${item.source}_pct`}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={manualRatios[item.source]}
                      onChange={(event) => setManualRatios((current) => ({
                        ...current,
                        [item.source]: Number(event.target.value),
                      }))}
                    />
                  </div>
                ))}
                <p className={`sm:col-span-3 text-xs ${Math.abs(manualTotal - 100) <= 0.01 ? "text-muted-foreground" : "text-red-400"}`}>
                  Manual allocation total: {manualTotal.toFixed(2)}%.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Bank, broker reference, or adjustment reason" />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Transaction"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
