"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordPlatformValuationAction } from "@/actions/fund";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LineChart } from "lucide-react";

type Props = {
  platformId: string;
  platformName: string;
  currentValue?: number | null;
  latestValuationDate?: string | null;
  compact?: boolean;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function RecordValuationForm({
  platformId,
  platformName,
  currentValue,
  latestValuationDate,
  compact = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await recordPlatformValuationAction(new FormData(event.currentTarget));
    setLoading(false);
    if (result?.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result?.error || "Failed to record valuation.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={
          compact
            ? "text-muted-foreground hover:text-foreground inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors hover:bg-muted"
            : "border-input bg-background hover:bg-accent inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium whitespace-nowrap shadow-sm transition-colors"
        }
      >
        <LineChart className="h-4 w-4" />
        Update value
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Record value — {platformName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <input type="hidden" name="platform_id" value={platformId} />
          <div className="space-y-2">
            <Label htmlFor={`total_value_${platformId}`}>Total value (RM)</Label>
            <Input
              id={`total_value_${platformId}`}
              name="total_value"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={currentValue ?? undefined}
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              What the whole platform is worth right now — cash plus positions, as your broker shows it.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`as_of_date_${platformId}`}>As of date</Label>
            <Input
              id={`as_of_date_${platformId}`}
              name="as_of_date"
              type="date"
              required
              max={todayIso()}
              defaultValue={todayIso()}
            />
            {latestValuationDate ? (
              <p className="text-muted-foreground text-xs">Last recorded {latestValuationDate}.</p>
            ) : (
              <p className="text-muted-foreground text-xs">No value recorded yet for this platform.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`valuation_notes_${platformId}`}>Notes (optional)</Label>
            <Input id={`valuation_notes_${platformId}`} name="notes" placeholder="e.g., from monthly statement" />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save value"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
