"use client";

import { useState } from "react";
import { createNavWeekAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

export function CreateNavWeekForm({ platforms }: { platforms: { id: string; name: string; unrealizedProfit: number; netInvested: number; equityNetInvested?: number; fixedSavingsNetInvested?: number; brokerageNetInvested?: number; totalValue?: number }[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const result = await createNavWeekAction(new FormData(event.currentTarget));
    setLoading(false);
    if (result?.success) setOpen(false);
    else alert(result?.error || "Failed to save NAV week.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 px-4 py-2 items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 gap-2">
        <Plus className="h-4 w-4" />
        New NAV Week
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Weekly NAV</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="week_ending">Friday Close</Label>
              <Input id="week_ending" name="week_ending" type="date" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustments">Manual Adjustments</Label>
              <Input id="adjustments" name="adjustments" type="number" step="0.01" defaultValue="0" required />
            </div>
          </div>
          <div className="space-y-3">
            <Label>Platform Final Value (RM)</Label>
            {platforms.map((platform) => (
              <div key={platform.id} className="grid grid-cols-[1fr_160px] items-center gap-3">
                <div>
                  <div className="text-sm font-medium">{platform.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Equity RM {(platform.equityNetInvested ?? platform.netInvested).toLocaleString()} · Fixed savings RM {(platform.fixedSavingsNetInvested ?? 0).toLocaleString()} · Brokerage RM {(platform.brokerageNetInvested ?? 0).toLocaleString()}
                  </div>
                </div>
                <Input
                  name={`platform_value_${platform.id}`}
                  type="number"
                  step="0.01"
                  defaultValue={platform.totalValue ?? platform.netInvested + platform.unrealizedProfit}
                  required
                />
              </div>
            ))}
            {platforms.length === 0 && (
              <p className="text-sm text-muted-foreground">Add a trading platform before creating NAV.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Statement date, FX source, or adjustment reason" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || platforms.length === 0}>{loading ? "Saving..." : "Save Draft"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
