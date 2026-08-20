"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordFundCashAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet } from "lucide-react";

type Props = {
  currentBalance: number;
  expectedBalance: number;
  latestDate?: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatRm(value: number) {
  return `RM ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function RecordFundCashForm({ currentBalance, expectedBalance, latestDate }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await recordFundCashAction(new FormData(event.currentTarget));
    setLoading(false);
    if (result?.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result?.error || "Failed to record fund cash.");
    }
  }

  const difference = Math.round((currentBalance - expectedBalance) * 100) / 100;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors">
        <Wallet className="h-4 w-4" />
        Update cash
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Record fund cash</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="fund_cash_balance">Bank balance (RM)</Label>
            <Input
              id="fund_cash_balance"
              name="balance"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={currentBalance}
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              Money the fund holds outside every platform — withdrawn from a broker, or investor capital not deployed
              yet.
            </p>
          </div>

          <div className="border-border/50 bg-muted/20 space-y-1 rounded-md border p-3 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Expected from your records</span>
              <span className="font-semibold">{formatRm(expectedBalance)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Last recorded</span>
              <span className="font-semibold">
                {latestDate ? `${formatRm(currentBalance)} on ${latestDate}` : "never"}
              </span>
            </div>
            {latestDate && Math.abs(difference) > 0.009 && (
              <p className="text-amber-400">
                Recorded balance is {formatRm(Math.abs(difference))} {difference > 0 ? "above" : "below"} what the
                ledgers imply. Worth checking before you lock a NAV.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fund_cash_date">As of date</Label>
            <Input
              id="fund_cash_date"
              name="as_of_date"
              type="date"
              required
              max={todayIso()}
              defaultValue={todayIso()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fund_cash_notes">Notes (optional)</Label>
            <Input id="fund_cash_notes" name="notes" placeholder="e.g., from bank statement" />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save balance"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
