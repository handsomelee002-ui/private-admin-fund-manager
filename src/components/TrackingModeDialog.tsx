"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePlatformTrackingMode } from "@/actions/trading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SlidersHorizontal } from "lucide-react";

export function TrackingModeDialog({
  id,
  platformName,
  currentMode,
}: {
  id: string;
  platformName: string;
  currentMode: "CASHFLOW" | "POSITION";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await updatePlatformTrackingMode(new FormData(event.currentTarget));
    setLoading(false);
    if (result?.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result?.error || "Failed to update tracking mode.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={`Change tracking mode for ${platformName}`}
        className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Tracking mode — {platformName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <input type="hidden" name="id" value={id} />
          <div className="space-y-2">
            <Label htmlFor={`tracking_mode_${id}`}>How should this platform be valued?</Label>
            <select
              id={`tracking_mode_${id}`}
              name="tracking_mode"
              defaultValue={currentMode}
              className="border-input bg-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
            >
              <option value="CASHFLOW">Cash flow — you enter one total value per period</option>
              <option value="POSITION">Positions — value computed from holdings and prices</option>
            </select>
          </div>
          <div className="text-muted-foreground space-y-2 text-xs">
            <p>
              <span className="text-foreground font-medium">Cash flow:</span> record money in and out, then record what
              the platform is worth whenever convenient. One number per period.
            </p>
            <p>
              <span className="text-foreground font-medium">Positions:</span> record BUY/SELL with quantity and price.
              Value is computed as holdings × latest price × FX, plus uninvested cash — no manual total needed, but every
              held asset needs a current price.
            </p>
            <p>Switching does not change existing transactions or recorded values, only how future NAV records value this platform.</p>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save mode"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
