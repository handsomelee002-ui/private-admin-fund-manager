"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { addPlatformTransaction } from "@/actions/trading";

const transactionTypes = [
  { value: "BROKER_DEPOSIT", label: "Money In" },
  { value: "BROKER_WITHDRAWAL", label: "Money Out" },
  { value: "ADJUSTMENT", label: "Adjustment" },
];

export function AddPlatformTransactionForm({
  platformId,
  defaultCurrency = "MYR",
}: {
  platformId: string;
  defaultCurrency?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add Platform Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select id="type" name="type" required defaultValue="BROKER_DEPOSIT" className="h-9 w-full rounded-md border border-input bg-card/50 px-3 text-sm">
                {transactionTypes.map((transactionType) => (
                  <option key={transactionType.value} value={transactionType.value}>{transactionType.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="base_amount">RM Amount</Label>
            <Input id="base_amount" name="base_amount" type="number" step="0.01" min="0.01" required placeholder="Final RM cost or RM received" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="funding_source">Funding Source</Label>
            <select id="funding_source" name="funding_source" required defaultValue="equity" className="h-9 w-full rounded-md border border-input bg-card/50 px-3 text-sm">
              <option value="equity">Equity Capital</option>
              <option value="fixed_savings">Fixed Savings Capital</option>
              <option value="brokerage">Brokerage Account</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="currency">Foreign Currency</Label>
              <Input id="currency" name="currency" required defaultValue={defaultCurrency} maxLength={10} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Foreign Amount</Label>
              <Input id="amount" name="amount" type="number" step="0.0001" placeholder="Final USD credited" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx_rate_to_base">FX To RM</Label>
              <Input id="fx_rate_to_base" name="fx_rate_to_base" type="number" step="0.000001" placeholder="Auto" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fee_amount">Fee Included (RM)</Label>
              <Input id="fee_amount" name="fee_amount" type="number" step="0.01" min="0" defaultValue="0" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Reference</Label>
              <Input id="reference" name="reference" placeholder="Bank, Wise, or broker reference" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Example: RM to Wise to IBKR, final USD credited" />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Transaction"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
