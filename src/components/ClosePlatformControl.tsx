"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { closePlatformAction, reopenPlatformAction } from "@/actions/trading";
import { Archive, RotateCcw } from "lucide-react";

/**
 * Shut a broker account, or undo it.
 *
 * Closing is what tells the fund the account is worth nothing. Until it is
 * closed, a platform with no recent valuation is carried at *cost*, so money
 * that is gone stays in gross assets and NAV per unit is overstated - and the
 * brokerage pot keeps treating the loss as a mark that might still recover
 * rather than one it has actually taken.
 */
export function ClosePlatformControl({
  platformId,
  platformName,
  closedOn,
}: {
  platformId: string;
  platformName: string;
  closedOn: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleClose(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const result = await closePlatformAction(new FormData(event.currentTarget));
    setLoading(false);
    if (result?.success) setOpen(false);
    else alert(result?.error || "Failed to close the platform.");
  }

  async function handleReopen() {
    if (!confirm(`Reopen ${platformName}? The zero valuation from the close stays on record.`)) return;
    setLoading(true);
    const result = await reopenPlatformAction(platformId);
    setLoading(false);
    if (!result?.success) alert(result?.error || "Failed to reopen the platform.");
  }

  if (closedOn) {
    return (
      <Button variant="outline" size="sm" disabled={loading} onClick={handleReopen} className="gap-2">
        <RotateCcw className="h-3.5 w-3.5" />
        {loading ? "Reopening..." : "Reopen Account"}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-background/60 px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted/40">
        <Archive className="h-4 w-4" />
        Close Account
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Close {platformName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleClose} className="space-y-4 pt-2">
          <input type="hidden" name="platform_id" value={platformId} />
          <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-400/90">
            This marks the platform at zero on the closing date. Anything it still held becomes a realised loss, and the
            brokerage pot stops treating it as a mark that might recover. Reversible, but the zero valuation stays on
            record.
          </div>
          <div className="space-y-2">
            <Label htmlFor="close_as_of_date">Closing date</Label>
            <Input
              id="close_as_of_date"
              name="as_of_date"
              type="date"
              required
              defaultValue={new Date().toISOString().split("T")[0]}
            />
            <p className="text-[10px] text-muted-foreground">
              Must be after the latest locked NAV week, which has already priced this platform.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="close_notes">Notes</Label>
            <Input id="close_notes" name="notes" placeholder="Why the account was closed" />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Closing..." : "Close Account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
