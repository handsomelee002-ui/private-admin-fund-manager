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
  };
}

export function SettleClaimDialog({ claim }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const locked    = parseFloat(String(claim.locked_amount));
  const settled   = parseFloat(String(claim.settled_amount));
  const remaining = Math.max(0, locked - settled);

  // Controlled state — reset to remaining when dialog opens
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 px-3 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium border border-emerald-500/30 text-emerald-500 bg-transparent hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors gap-1.5">
        <CheckCircle className="h-3.5 w-3.5" />
        Settle
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Settle Profit Claim — {claim.investor_name}</DialogTitle>
        </DialogHeader>

        <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1 border border-border/50">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Locked (IOU)</span>
            <span className="font-semibold">
              RM {locked.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Already Settled</span>
            <span className="font-semibold text-emerald-400">
              RM {settled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
            <span className="text-muted-foreground font-medium">Remaining</span>
            <span className="font-bold text-amber-400">
              RM {remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Amount Being Settled Now (RM)</Label>
            <Input
              name="settled_amount"
              type="number"
              step="0.01"
              required
              value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-[10px] text-muted-foreground">
              Partial settlement supported — remaining balance stays pending.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Settlement Date</Label>
            <Input
              name="settled_date"
              type="date"
              required
              value={settleDate}
              onChange={(e) => setSettleDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Input
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paid via bank transfer"
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading} className="gap-2">
              <CheckCircle className="h-4 w-4" />
              {loading ? "Saving..." : "Confirm Settlement"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
