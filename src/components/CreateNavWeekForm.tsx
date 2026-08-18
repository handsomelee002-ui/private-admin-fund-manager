"use client";

import { useCallback, useEffect, useState } from "react";
import { createNavWeekAction, getNavPreviewAction } from "@/actions/fund";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Plus } from "lucide-react";

type PreviewRow = {
  platformId: string;
  platformName: string;
  trackingMode: string;
  netInvested: number;
  totalValue: number;
  profitLoss: number;
  source: string;
  valuationDate: string | null;
  ageDays: number | null;
  isStale: boolean;
  weightPercent: number;
  missingPrices: string[];
};

const SOURCE_LABELS: Record<string, string> = {
  COMPUTED: "computed from holdings",
  RECORDED: "recorded",
  CARRIED_FORWARD: "carried forward",
  RECORDED_FALLBACK: "recorded (prices missing)",
  NET_INVESTED_FALLBACK: "never valued",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ageLabel(row: PreviewRow) {
  if (row.source === "COMPUTED") return "live";
  if (row.ageDays === null) return "never";
  if (row.ageDays === 0) return "today";
  return `${row.ageDays}d old`;
}

export function CreateNavWeekForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async (date: string) => {
    setPreviewLoading(true);
    setError(null);
    const result = await getNavPreviewAction(date);
    setPreviewLoading(false);
    if ("preview" in result && result.preview) {
      setRows(result.preview as PreviewRow[]);
    } else {
      setRows([]);
      setError(result.error || "Failed to load platform values.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadPreview(asOfDate);
  }, [open, asOfDate, loadPreview]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const result = await createNavWeekAction(formData);
    setLoading(false);
    if (result?.success) {
      setOpen(false);
      setOverrides({});
    } else {
      setError(result?.error || "Failed to save NAV.");
    }
  }

  const effectiveValue = (row: PreviewRow) => {
    const override = overrides[row.platformId];
    if (override !== undefined && override.trim() !== "") {
      const parsed = Number(override);
      if (Number.isFinite(parsed)) return parsed;
    }
    return row.totalValue;
  };

  const grossAssets = rows.reduce((sum, row) => sum + effectiveValue(row), 0);
  const staleRows = rows.filter((row) => row.isStale);
  const blockingRows = staleRows.filter((row) => row.weightPercent >= 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow">
        <Plus className="h-4 w-4" />
        New NAV
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-none"
        style={{ width: "min(calc(100vw - 2rem), 52rem)", maxWidth: "none" }}
      >
        <DialogHeader>
          <DialogTitle>Review &amp; create NAV</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="week_ending">Valuation date</Label>
              <Input
                id="week_ending"
                name="week_ending"
                type="date"
                required
                max={todayIso()}
                value={asOfDate}
                onChange={(event) => setAsOfDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustments">Manual adjustments</Label>
              <Input id="adjustments" name="adjustments" type="number" step="0.01" defaultValue="0" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input id="notes" name="notes" placeholder="e.g., month-end lock" />
            </div>
          </div>

          <div className="border-border/60 overflow-hidden rounded-md border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Platform</th>
                    <th className="px-3 py-2 text-right font-medium">Net invested</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                    <th className="px-3 py-2 text-left font-medium">Valued</th>
                    <th className="px-3 py-2 text-right font-medium">Override</th>
                  </tr>
                </thead>
                <tbody>
                  {previewLoading && (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground px-3 py-8 text-center">
                        Loading platform values...
                      </td>
                    </tr>
                  )}
                  {!previewLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground px-3 py-8 text-center">
                        No platforms yet. Add a platform before creating a NAV.
                      </td>
                    </tr>
                  )}
                  {!previewLoading &&
                    rows.map((row) => {
                      const value = effectiveValue(row);
                      const profitLoss = value - row.netInvested;
                      return (
                        <tr key={row.platformId} className="border-border/40 border-t">
                          <td className="px-3 py-2">
                            <div className="font-medium">{row.platformName}</div>
                            <div className="text-muted-foreground text-xs">
                              {row.trackingMode === "POSITION" ? "positions" : "cash flow"} · {row.weightPercent.toFixed(1)}% of fund
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.netInvested)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(value)}</td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${profitLoss < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                          >
                            {formatMoney(profitLoss)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <Badge variant={row.isStale ? "destructive" : "outline"}>{ageLabel(row)}</Badge>
                            </div>
                            <div className="text-muted-foreground mt-0.5 text-xs">
                              {SOURCE_LABELS[row.source] ?? row.source}
                              {row.missingPrices.length > 0 && ` · no price: ${row.missingPrices.join(", ")}`}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              className="ml-auto h-8 w-32"
                              name={`platform_value_${row.platformId}`}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="—"
                              value={overrides[row.platformId] ?? ""}
                              onChange={(event) =>
                                setOverrides((current) => ({ ...current, [row.platformId]: event.target.value }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {blockingRows.length > 0 && (
            <div className="border-destructive/40 bg-destructive/10 text-destructive flex gap-2 rounded-md border p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Stale values on material platforms</p>
                <p className="mt-0.5">
                  {blockingRows.map((row) => row.platformName).join(", ")} —{" "}
                  {blockingRows.length === 1 ? "this platform is" : "these platforms are"} over 30 days old and 10%+ of the
                  fund. You can still lock this NAV for reporting, but it will refuse to settle deposits or withdrawals
                  until refreshed.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-muted-foreground">Gross assets </span>
              <span className="font-semibold tabular-nums">{formatMoney(grossAssets)}</span>
              {staleRows.length > 0 && (
                <span className="text-muted-foreground ml-2 text-xs">
                  ({staleRows.length} carried forward)
                </span>
              )}
            </div>
            <Button type="submit" disabled={loading || rows.length === 0}>
              {loading ? "Saving..." : "Save draft"}
            </Button>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
