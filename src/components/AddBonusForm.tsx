"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Gift } from "lucide-react";
import { addBonusPayment } from "@/actions/settings";

interface Props {
  investors: { id: string; name: string }[];
}

export function AddBonusForm({ investors }: Props) {
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [targetType, setTargetType] = useState<"specific" | "all">("specific");
  const [investorId, setInvestorId] = useState("");
  const [ledgerType, setLedgerType] = useState<"equity" | "fixed_savings">("equity");
  const [amount, setAmount]         = useState("");
  const [date, setDate]             = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes]           = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (targetType === "specific" && !investorId) {
      alert("Please select an investor");
      return;
    }
    setLoading(true);
    const fd = new FormData();
    fd.set("target_type", targetType);
    fd.set("investor_id", investorId);
    fd.set("ledger_type", ledgerType);
    fd.set("amount", amount);
    fd.set("date", date);
    fd.set("notes", notes);
    const res = await addBonusPayment(fd);
    setLoading(false);
    if (res?.success) {
      setOpen(false);
      setAmount("");
      setNotes("");
    } else {
      alert(res?.error || "Failed to add bonus.");
    }
  }

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-card/50 px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 transition-colors gap-2">
        <Gift className="h-4 w-4" />
        Add Bonus
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Special Bonus Payment</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Distribute a one-time bonus to a specific investor or all investors proportionally.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Target Type */}
          <div className="space-y-2">
            <Label>Target</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetType("specific")}
                className={`h-9 rounded-md border text-sm font-medium transition-colors ${
                  targetType === "specific"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Specific Investor
              </button>
              <button
                type="button"
                onClick={() => { setTargetType("all"); setInvestorId(""); }}
                className={`h-9 rounded-md border text-sm font-medium transition-colors ${
                  targetType === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                All Investors
              </button>
            </div>
          </div>

          {/* Investor Selector — only when specific */}
          {targetType === "specific" && (
            <div className="space-y-2">
              <Label>Investor</Label>
              <select
                value={investorId}
                onChange={(e) => setInvestorId(e.target.value)}
                required
                className={selectClass}
              >
                <option value="">Select investor...</option>
                {investors.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Ledger Type */}
          <div className="space-y-2">
            <Label>Apply to Ledger</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLedgerType("equity")}
                className={`h-9 rounded-md border text-sm font-medium transition-colors ${
                  ledgerType === "equity"
                    ? "bg-violet-500/20 text-violet-400 border-violet-500/40"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Equity Ledger
              </button>
              <button
                type="button"
                onClick={() => setLedgerType("fixed_savings")}
                className={`h-9 rounded-md border text-sm font-medium transition-colors ${
                  ledgerType === "fixed_savings"
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Fixed Savings
              </button>
            </div>
            {targetType === "all" && (
              <p className="text-[10px] text-muted-foreground">
                {ledgerType === "equity"
                  ? "Amount will be distributed proportionally based on each investor's equity % share."
                  : "Amount will be distributed proportionally based on each investor's savings balance %."}
              </p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label>
              {targetType === "all" ? "Total Bonus Amount (RM) — distributed proportionally" : "Bonus Amount (RM)"}
            </Label>
            <Input
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label>Date</Label>
            <Input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Input
              placeholder="e.g. Q1 performance bonus"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading} className="gap-2">
              <Gift className="h-4 w-4" />
              {loading ? "Saving..." : "Add Bonus"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
