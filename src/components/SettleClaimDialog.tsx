"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle } from "lucide-react";
import { settleClaim } from "@/actions/profitClaims";

interface Props {
  claim: {
    id: string;
    investor_name: string;
    locked_amount: string | number;
    settled_amount: string | number;
    brokerage_fee?: string | number;
  };
}

export function SettleClaimDialog({ claim }: Props) {
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);

  const r2 = (n: number) => Math.round(n * 100) / 100;

  const locked       = r2(parseFloat(String(claim.locked_amount)));
  const prevSettled  = r2(parseFloat(String(claim.settled_amount)));
  const brokerageFee = r2(parseFloat(String(claim.brokerage_fee || "0")));
  // Net payable = gross profit - performance fee
  const netPayable   = r2(locked - brokerageFee);
  const remaining    = r2(Math.max(0, netPayable - prevSettled));

  const [settleAmount, setSettleAmount] = useState(remaining.toFixed(2));
  const [settleDate, setSettleDate]     = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes]               = useState("");

  useEffect(() => {
    if (open) {
      setSettleAmount(remaining.toFixed(2));
      setSettleDate(new Date().toISOString().split("T")[0]);
      setNotes("");
    }
  }, [open, remaining]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData();
    formData.set("id", claim.id);
    formData.set("settled_amount", settleAmount);
    formData.set("settled_date", settleDate);
    formData.set("notes", notes);
    const res = await settleClaim(formData);
    setLoading(false);
    if (res?.success) {
      setOpen(false);
    } else {
      alert(res?.error || "Failed to settle claim.");
    }
  }

  const fmt = (n: number) =>
    `RM ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 px-3 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium border border-emerald-500/30 text-emerald-500 bg-transparent hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors gap-1.5">
        <CheckCircle className="h-3.5 w-3.5" />
        Settle
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Settle Profit Claim — {claim.investor_name}</DialogTitle>
        </DialogHeader>

        {/* Claim breakdown */}
        <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1 border border-border/50">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Gross Profit (IOU)</span>
            <span className="font-semibold">{fmt(locked)}</span>
          </div>
          {brokerageFee > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Performance Fee (Brokerage)</span>
              <span className="font-semibold text-red-400">− {fmt(brokerageFee)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
            <span className="text-muted-foreground font-medium">Net Payable to Investor</span>
            <span className="font-bold text-primary">{fmt(netPayable)}</span>
          </div>
          {prevSettled > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Already Paid</span>
              <span className="font-semibold text-emerald-400">− {fmt(prevSettled)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
            <span className="text-muted-foreground font-medium">Outstanding Balance</span>
            <span className="font-bold text-amber-400">{fmt(remaining)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Amount Being Paid Now (RM)</Label>
            <Input
              type="number"
              step="0.01"
              required
              value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value)}
              placeholder="0.00"
              max={remaining}
            />
            <p className="text-[10px] text-muted-foreground">
              Max: {fmt(remaining)}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Settlement Date</Label>
            <Input
              type="date"
              required
              value={settleDate}
              onChange={(e) => setSettleDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paid via bank transfer"
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading || remaining <= 0} className="gap-2">
              <CheckCircle className="h-4 w-4" />
              {loading ? "Saving..." : "Confirm Settlement"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
