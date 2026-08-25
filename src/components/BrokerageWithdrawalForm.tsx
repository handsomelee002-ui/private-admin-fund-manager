"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/formatting";
import { recordBrokerageWithdrawalAction } from "@/actions/settings";
import { Banknote } from "lucide-react";

export function BrokerageWithdrawalForm({ available }: { available: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");

  // Nothing to take out. The server rejects it too, but disabling the control
  // says so before the operator types a number and gets refused.
  const canWithdraw = available > 0;
  const entered = Number(amount) || 0;
  const overCap = entered > available + 0.005;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const result = await recordBrokerageWithdrawalAction(new FormData(event.currentTarget));
    setLoading(false);
    if (result?.success) {
      setOpen(false);
      setAmount("");
    } else {
      alert(result?.error || "Failed to record withdrawal.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        disabled={!canWithdraw}
        className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        <Banknote className="h-4 w-4" />
        Withdraw
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Withdraw from Brokerage</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Available to withdraw: <span className="font-semibold text-foreground">{formatMoney(available)}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="withdrawal_date">Date</Label>
            <Input
              id="withdrawal_date"
              name="date"
              type="date"
              required
              defaultValue={new Date().toISOString().split("T")[0]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="withdrawal_amount">Amount</Label>
            <Input
              id="withdrawal_amount"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={available}
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
            {overCap && (
              <p className="text-xs text-red-400">
                Exceeds the {formatMoney(available)} the pot holds.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="withdrawal_notes">Notes</Label>
            <Input id="withdrawal_notes" name="notes" placeholder="Bank reference or reason" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            This reduces the fund&apos;s recorded bank balance by the same amount, so the pot and the bank stay in step.
          </p>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading || overCap || entered <= 0}>
              {loading ? "Saving..." : "Record Withdrawal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
