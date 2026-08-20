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
  netInvested: number;
  totalValue: number;
  profitLoss: number;
  source: string;
  valuationDate: string | null;
  ageDays: number | null;
  isStale: boolean;
  weightPercent: number;
};

type FundCash = {
  balance: number;
  source: string;
  asOfDate: string | null;
  ageDays: number | null;
  isStale: boolean;
  expectedBalance: number;
};

const SOURCE_LABELS: Record<string, string> = {
  RECORDED: "recorded",
  CARRIED_FORWARD: "carried forward",
  NET_INVESTED_FALLBACK: "never valued",
  NEVER_RECORDED: "never recorded",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ageLabel(item: { ageDays: number | null }) {
  if (item.ageDays === null) return "never";
  if (item.ageDays === 0) return "today";
  return `${item.ageDays}d old`;
}

export function CreateNavWeekForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fundCash, setFundCash] = useState<FundCash | null>(null);
  const [fundCashOverride, setFundCashOverride] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async (date: string) => {
    setPreviewLoading(true);
    setError(null);
    const result = await getNavPreviewAction(date);
    setPreviewLoading(false);
    if ("preview" in result && result.preview) {
      setRows(result.preview as PreviewRow[]);
      setFundCash((result.fundCash as FundCash) ?? null);
    } else {
      setRows([]);
      setFundCash(null);
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
      setFundCashOverride("");
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

  const effectiveFundCash = (() => {
    if (fundCashOverride.trim() !== "") {
      const parsed = Number(fundCashOverride);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fundCash?.balance ?? 0;
  })();

  const platformValue = rows.reduce((sum, row) => sum + effectiveValue(row), 0);
  const grossAssets = platformValue + effectiveFundCash;
  const cashGap = fundCash ? Math.round((effectiveFundCash - fundCash.expectedBalance) * 100) / 100 : 0;
  const staleRows = rows.filter((row) => row.isStale);
  const blockingRows = staleRows.filter((row) => row.weightPercent >= 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap shadow">
        <Plus className="h-4 w-4" />
        New NAV
      </DialogTrigger>
      <DialogContent
        className="grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-4 sm:max-w-none"
        style={{
          width: "min(calc(100vw - 2rem), 52rem)",
          height: "min(46rem, calc(100dvh - 6rem))",
          maxWidth: "none",
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Review &amp; create NAV</DialogTitle>
        </DialogHeader>
        {/* Date controls and the save footer stay put; only the platform list
            scrolls, so gross assets and Save draft never leave the screen. */}
        <form onSubmit={handleSubmit} className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 pt-2">
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

          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1">
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
                              {row.weightPercent.toFixed(1)}% of fund
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
                              {row.valuationDate ? ` ${row.valuationDate}` : ""}
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
                  {!previewLoading && fundCash && (
                    <tr className="border-border/40 bg-muted/20 border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">Fund cash</div>
                        <div className="text-muted-foreground text-xs">
                          not in any platform · {grossAssets > 0 ? ((effectiveFundCash / grossAssets) * 100).toFixed(1) : "0.0"}% of fund
                        </div>
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">—</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(effectiveFundCash)}</td>
                      <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">—</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={fundCash.isStale ? "destructive" : "outline"}>{ageLabel(fundCash)}</Badge>
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-xs">
                          expected {formatMoney(fundCash.expectedBalance)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          className="ml-auto h-8 w-32"
                          name="fund_cash"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="—"
                          value={fundCashOverride}
                          onChange={(event) => setFundCashOverride(event.target.value)}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {fundCash && Math.abs(cashGap) > 0.009 && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Fund cash does not match your records</p>
                <p className="mt-0.5">
                  Your platform and capital movements imply {formatMoney(fundCash.expectedBalance)}, but this NAV uses{" "}
                  {formatMoney(effectiveFundCash)} — a gap of {formatMoney(Math.abs(cashGap))}. That is fine if money
                  moved outside the app; otherwise something is unrecorded.
                </p>
              </div>
            </div>
          )}

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

          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Gross assets </span>
              <span className="font-semibold tabular-nums">{formatMoney(grossAssets)}</span>
              <span className="text-muted-foreground ml-2 text-xs">
                ({formatMoney(platformValue)} in platforms + {formatMoney(effectiveFundCash)} cash
                {staleRows.length > 0 ? `, ${staleRows.length} carried forward` : ""})
              </span>
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
