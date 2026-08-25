"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Handshake } from "lucide-react";
import { addProfitClaim } from "@/actions/profitClaims";

interface Props {
  investorId: string;
  investorName: string;
  /** Pre-filled amount = their current unrealized profit share */
  defaultAmount?: number;
}

export function AddProfitClaimForm({ investorId, investorName, defaultAmount }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.set("investor_id", investorId);
    const res = await addProfitClaim(formData);
    setLoading(false);
    if (res?.success) {
      setOpen(false);
    } else {
      alert(res?.error || "Failed to create claim.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium border border-amber-500/40 text-amber-400 bg-transparent hover:bg-amber-500/10 hover:text-amber-300 transition-colors gap-2">
        <Handshake className="h-4 w-4" />
        Lock Profit Claim
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Lock Profit Claim — {investorName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Claim Date (Withdrawal Date)</Label>
            <Input
              name="claim_date"
              type="date"
              required
              defaultValue={new Date().toISOString().split("T")[0]}
            />
          </div>
          <div className="space-y-2">
            <Label>Locked Profit Amount (RM)</Label>
            <Input
              name="locked_amount"
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              defaultValue={defaultAmount?.toFixed(2) ?? ""}
            />
            {defaultAmount && defaultAmount > 0 && (
              <p className="text-[10px] text-amber-400">
                Pre-filled with current unrealized profit share: RM {defaultAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Input name="notes" placeholder="e.g. Capital exit Jan 2026 — profit IOU" />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading} className="gap-2">
              <Handshake className="h-4 w-4" />
              {loading ? "Saving..." : "Lock Claim"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
