"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, TrendingUp } from "lucide-react";
import { addPlatformTransaction } from "@/actions/trading";

export function AddPlatformTransactionForm({ platformId }: { platformId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState("Deposit");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.append("platform_id", platformId);
    const res = await addPlatformTransaction(formData);
    setLoading(false);
    if (res?.success) {
      setOpen(false);
      setType("Deposit");
    } else {
      alert(res?.error || "An error occurred");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 gap-2">
        <Plus className="h-4 w-4" />
        Add Transaction
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Capital Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
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
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-card/50 px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="Deposit">Deposit (Capital In)</option>
              <option value="Withdraw">Withdraw (Capital Out)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (RM)</Label>
            <Input id="amount" name="amount" type="number" step="0.01" required placeholder="0.00" />
          </div>

          {/* Realized Profit — only shown for withdrawals */}
          {type === "Withdraw" && (
            <div className="p-3 bg-muted/50 rounded-md space-y-2 border border-emerald-500/20">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
                <TrendingUp className="h-4 w-4" />
                Realized Profit (Optional)
              </div>
              <p className="text-xs text-muted-foreground leading-tight">
                If this withdrawal includes profit, enter the realized P&amp;L amount. Leave blank if it&apos;s a pure capital return.
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Realized Profit (RM)</Label>
                <Input
                  id="realized_profit"
                  name="realized_profit"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 1500.00"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Optional notes" />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Transaction"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
