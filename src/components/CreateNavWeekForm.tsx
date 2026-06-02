"use client";

import { useState } from "react";
import { createNavWeekAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Plus } from "lucide-react";

export function CreateNavWeekForm({ platforms }: { platforms: { id: string; name: string; unrealizedProfit: number; netInvested: number; equityNetInvested?: number; fixedSavingsNetInvested?: number; brokerageNetInvested?: number; totalValue?: number }[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activePlatformInfo, setActivePlatformInfo] = useState<string | null>(null);

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
      <DialogContent
        className="sm:max-w-none"
        style={{
          width: "min(calc(100vw - 2rem), 31rem)",
          maxWidth: "none",
        }}
      >
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
              <div key={platform.id} className="flex items-center gap-4 rounded-md py-0.5">
                <Label
                  htmlFor={`platform_value_${platform.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"
                >
                  <span className="truncate">{platform.name}</span>
                  <span
                    className="relative inline-flex"
                    onMouseEnter={() => setActivePlatformInfo(platform.id)}
                    onMouseLeave={() => setActivePlatformInfo((current) => (current === platform.id ? null : current))}
                  >
                    <button
                      type="button"
                      aria-label={`${platform.name} allocation details`}
                      aria-expanded={activePlatformInfo === platform.id}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onFocus={() => setActivePlatformInfo(platform.id)}
                      onBlur={() => setActivePlatformInfo((current) => (current === platform.id ? null : current))}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                    {activePlatformInfo === platform.id && (
                      <span className="absolute left-7 top-1/2 z-[70] w-64 -translate-y-1/2 rounded-md border border-border/70 bg-popover p-3 text-xs font-normal text-popover-foreground shadow-xl ring-1 ring-foreground/5">
                        <span className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border-b border-l border-border/70 bg-popover" />
                        <span className="relative block">
                          <span className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">Equity</span>
                            <span className="font-medium">RM {(platform.equityNetInvested ?? platform.netInvested).toLocaleString()}</span>
                          </span>
                          <span className="mt-1.5 flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">Fixed savings</span>
                            <span className="font-medium">RM {(platform.fixedSavingsNetInvested ?? 0).toLocaleString()}</span>
                          </span>
                          <span className="mt-1.5 flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">Brokerage</span>
                            <span className="font-medium">RM {(platform.brokerageNetInvested ?? 0).toLocaleString()}</span>
                          </span>
                        </span>
                      </span>
                    )}
                  </span>
                </Label>
                <Input
                  id={`platform_value_${platform.id}`}
                  className="w-40 shrink-0"
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
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || platforms.length === 0}>{loading ? "Saving..." : "Save Draft"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
