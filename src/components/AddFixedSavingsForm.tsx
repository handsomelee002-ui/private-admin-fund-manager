"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addFixedSavingsRecord } from "@/actions/fixedSavings";
import { PlusCircle, Percent, TrendingUp } from "lucide-react";

export function AddFixedSavingsForm({
  investors,
  defaultInvestorId,
}: {
  investors: any[];
  defaultInvestorId?: string;
  /** @deprecated no longer used – interest is computed dynamically */
  currentBalance?: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState("Deposit");
  const [amount, setAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");

  // Live preview: how much interest would accrue from today at the entered rate
  const previewInterest = (() => {
    const p = parseFloat(amount);
    const r = parseFloat(interestRate);
    if (isNaN(p) || isNaN(r) || p <= 0 || r <= 0) return null;
    // Show projected interest after 1 year and after 30 days for reference
    const daily = p * (Math.pow(1 + r / 100 / 365, 365) - 1);
    const monthly = p * (Math.pow(1 + r / 100 / 365, 30) - 1);
    return { annual: daily, monthly };
  })();

  const [investorId, setInvestorId] = useState(defaultInvestorId || "");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!investorId) {
      alert("Please select an investor");
      return;
    }
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    // Shadcn Select values don't flow through native FormData — inject from state
    formData.set("investor_id", investorId);
    formData.set("type", type);
    const res = await addFixedSavingsRecord(formData);
    setLoading(false);
    if (res?.error) {
      alert(res.error);
    } else {
      setOpen(false);
      setAmount("");
      setInterestRate("");
      setType("Deposit");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 gap-2">
        <PlusCircle className="h-4 w-4" />
        Add Fixed Savings Tx
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Fixed Savings Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-4">
          {/* Investor selector (global ledger page) */}
          {!defaultInvestorId && (
            <div className="space-y-2">
              <Label>Investor</Label>
              <Select
                value={investorId}
                onValueChange={(val) => { if (val) setInvestorId(val); }}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select investor..." />
                </SelectTrigger>
                <SelectContent>
                  {investors.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date */}
          <div className="space-y-2">
            <Label>Date (Deposit / Transaction Date)</Label>
            <Input
              type="date"
              name="date"
              required
              defaultValue={new Date().toISOString().split("T")[0]}
            />
          </div>

          {/* Transaction Type */}
          <div className="space-y-2">
            <Label>Transaction Type</Label>
            <Select name="type" required value={type} onValueChange={(val) => { if (val) setType(val); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Deposit">Deposit</SelectItem>
                <SelectItem value="Withdrawal">Withdrawal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label>Amount (RM)</Label>
            <Input
              type="number"
              step="0.01"
              name="amount"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {/* Annual Interest Rate — only shown for Deposit */}
          {type === "Deposit" && (
            <div className="p-3 bg-muted/50 rounded-md space-y-3 border border-border/50">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Percent className="h-4 w-4" />
                Annual Interest Rate
              </div>
              <p className="text-xs text-muted-foreground leading-tight">
                Enter the p.a. interest rate for this deposit. The system will
                automatically calculate accrued interest up to today using{" "}
                <strong>daily compounding</strong>.
              </p>

              <div className="space-y-1">
                <Label className="text-xs">Rate (% per annum)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.0001"
                    name="interest_rate"
                    placeholder="e.g. 3.85"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    %
                  </span>
                </div>
              </div>

              {previewInterest && (
                <div className="mt-2 pt-2 border-t border-border flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <TrendingUp className="h-3 w-3" />
                    Projected interest (daily compounding)
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">After 30 days:</span>
                    <span className="font-medium text-orange-500">
                      +RM{" "}
                      {previewInterest.monthly.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-muted-foreground">After 1 year:</span>
                    <span className="text-primary">
                      +RM{" "}
                      {previewInterest.annual.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Input name="notes" placeholder="e.g. Bank Islam FD — Dec promo" />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Saving..." : "Save Transaction"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
