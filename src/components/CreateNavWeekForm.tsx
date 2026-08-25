"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createNavWeekAction, getNavPreviewAction } from "@/actions/fund";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HoverDetail } from "@/components/HoverDetail";
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

/**
 * How the bank balance divides between the pools with a claim on it. Only
 * equity's share prices the units, so this is what the screen must show.
 */
type CashAttribution = {
  bankBalance: number;
  nonEquityValueInPlatforms: number;
  fixedSavingsLiability: number;
  brokerageClaim: number;
  equity: number;
};

const SOURCE_LABELS: Record<string, string> = {
  RECORDED: "recorded",
  CARRIED_FORWARD: "carried forward",
  NAV_SNAPSHOT: "from last NAV",
  NET_INVESTED_FALLBACK: "never valued",
  NEVER_RECORDED: "never recorded",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Who owns the bank balance. Only equity's share prices the units, so this is
 * what makes gross assets add up against the balance shown on the row.
 */
function CashAttributionDetail({ attribution }: { attribution: CashAttribution }) {
  return (
    <div className="space-y-1">
      <p className="text-foreground text-sm font-medium">
        Who owns the {formatMoney(attribution.bankBalance)} in the bank
      </p>
      <p className="text-muted-foreground text-xs">
        Fixed-savings savers are owed {formatMoney(attribution.fixedSavingsLiability)} and the brokerage pot holds{" "}
        {formatMoney(attribution.brokerageClaim)}
        {attribution.nonEquityValueInPlatforms > 0.009
          ? `, of which ${formatMoney(attribution.nonEquityValueInPlatforms)} sits inside platforms rather than in cash`
          : ""}
        . Equity owns the remaining {formatMoney(attribution.equity)}, and only that share prices the units.
      </p>
    </div>
  );
}

function ageLabel(item: { ageDays: number | null }) {
  if (item.ageDays === null) return "never";
  if (item.ageDays === 0) return "today";
  return `${item.ageDays}d old`;
}

export function CreateNavWeekForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fundCash, setFundCash] = useState<FundCash | null>(null);
  const [fundCashOverride, setFundCashOverride] = useState("");
  // Set only by the admin typing in the box, never by the pre-fill. Saving
  // records a new bank anchor only when this is true.
  const [fundCashEdited, setFundCashEdited] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [attribution, setAttribution] = useState<CashAttribution | null>(null);
  const [equityPlatformValue, setEquityPlatformValue] = useState(0);
  const [grossAssets, setGrossAssets] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The cash box is pre-filled with the expected balance once per valuation
  // date. Seeding from inside the preview effect would otherwise re-trigger it
  // forever, and a new date implies a new expected figure, so the seed is keyed
  // on the date rather than fired once per dialog.
  const seededDateRef = useRef<string | null>(null);
  // A draft's overrides are seeded the same way and for the same reason: once
  // per date, never from inside the refetch the seeding itself triggers, and
  // never over a box the admin is currently typing into.
  const seededDraftDateRef = useRef<string | null>(null);

  const loadPreview = useCallback(async (
    date: string,
    platformOverrides: Record<string, string>,
    cashOverride: string,
  ) => {
    setPreviewLoading(true);
    setError(null);
    const parsedOverrides = Object.entries(platformOverrides)
      .filter(([, value]) => value.trim() !== "" && Number.isFinite(Number(value)))
      .map(([platformId, value]) => ({ platformId, totalValue: Number(value) }));
    const parsedCash = cashOverride.trim() !== "" && Number.isFinite(Number(cashOverride))
      ? Number(cashOverride)
      : undefined;
    const result = await getNavPreviewAction(date, parsedOverrides, parsedCash);
    setPreviewLoading(false);
    if ("preview" in result && result.preview) {
      const cash = (result.fundCash as FundCash) ?? null;
      setRows(result.preview as PreviewRow[]);
      setFundCash(cash);
      setAttribution((result.attribution as CashAttribution) ?? null);
      setEquityPlatformValue(result.equityPlatformValue ?? 0);
      setGrossAssets(result.grossAssets ?? 0);
      // A bank account cannot hold less than nothing and recordFundCash rejects
      // a negative balance, so a ledger-implied overdraft seeds as zero.
      if (cash && seededDateRef.current !== date) {
        seededDateRef.current = date;
        setFundCashOverride(Math.max(0, cash.expectedBalance).toFixed(2));
        setFundCashEdited(false);
      }
      // Resume a draft already saved for this date. Its overrides are not value
      // marks any more, so without this the Override column comes back empty and
      // the next Save draft recomputes the week from carried forward values,
      // throwing away what was typed.
      const saved = (result.draftOverrides as { platformId: string; totalValue: number }[]) ?? [];
      if (seededDraftDateRef.current !== date) {
        seededDraftDateRef.current = date;
        if (saved.length > 0) {
          setOverrides((current) => {
            const seeded = { ...current };
            for (const item of saved) {
              if (seeded[item.platformId] === undefined) {
                seeded[item.platformId] = item.totalValue.toFixed(2);
              }
            }
            return seeded;
          });
        }
      }
    } else {
      setRows([]);
      setFundCash(null);
      setAttribution(null);
      setEquityPlatformValue(0);
      setGrossAssets(0);
      setError(result.error || "Failed to load platform values.");
    }
  }, []);

  // Overrides change what equity's share of the cash works out to, so the whole
  // preview is re-derived server-side rather than re-totalled in the browser.
  useEffect(() => {
    if (!open) {
      // Preview state outlives the dialog, so without this a reopen paints the
      // previous session's figures until the refetch lands.
      seededDateRef.current = null;
      seededDraftDateRef.current = null;
      setFundCashEdited(false);
      setRows([]);
      setFundCash(null);
      setAttribution(null);
      setEquityPlatformValue(0);
      setGrossAssets(0);
      return;
    }
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      void loadPreview(asOfDate, overrides, fundCashOverride);
    }, 400);
    return () => clearTimeout(timer);
  }, [open, asOfDate, overrides, fundCashOverride, loadPreview]);

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
      setFundCashEdited(false);
      seededDraftDateRef.current = null;
      // Same as LockNavButton: an imperative action call leaves the NAV
      // register and the platform panel rendering their pre-save payload.
      router.refresh();
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

  const cashGap = fundCash ? Math.round((effectiveFundCash - fundCash.expectedBalance) * 100) / 100 : 0;
  // The pre-filled figure is derived from the ledgers, not measured. This is the
  // distance from the last balance actually confirmed against a bank statement.
  const unconfirmedGap = fundCash ? Math.round((effectiveFundCash - fundCash.balance) * 100) / 100 : 0;
  // With no savers' money and an empty pot the whole balance is equity's, so
  // there is nothing to attribute and the row gets no popup.
  const hasCashAttribution = Boolean(
    attribution && (attribution.fixedSavingsLiability > 0.009 || Math.abs(attribution.brokerageClaim) > 0.009),
  );
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
                  {previewLoading && rows.length === 0 && (
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
                  {/* Deliberately not gated on previewLoading. Unmounting these
                      rows mid-refetch destroys the override input being typed
                      into and takes focus with it. */}
                  {rows.map((row) => {
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
                  {fundCash && (
                    <tr className="border-border/40 bg-muted/20 border-t">
                      <td className="px-3 py-2">
                        {attribution && hasCashAttribution ? (
                          <HoverDetail
                            detailClassName="w-[24rem]"
                            detail={<CashAttributionDetail attribution={attribution} />}
                          >
                            <div className="font-medium underline decoration-dotted underline-offset-4">Fund cash</div>
                            <div className="text-muted-foreground text-xs">
                              bank balance · {formatMoney(attribution.equity)} is equity&apos;s
                            </div>
                          </HoverDetail>
                        ) : (
                          <>
                            <div className="font-medium">Fund cash</div>
                            <div className="text-muted-foreground text-xs">
                              bank balance · {attribution ? `${formatMoney(attribution.equity)} is equity's` : "not in any platform"}
                            </div>
                          </>
                        )}
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
                          onChange={(event) => {
                            setFundCashOverride(event.target.value);
                            setFundCashEdited(true);
                          }}
                        />
                        <input type="hidden" name="fund_cash_confirmed" value={fundCashEdited ? "1" : ""} />
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

          {fundCash && Math.abs(unconfirmedGap) > 0.009 && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  This NAV will record {formatMoney(effectiveFundCash)} as the bank balance
                </p>
                <p className="mt-0.5">
                  {fundCash.asOfDate
                    ? `You last confirmed ${formatMoney(fundCash.balance)} on ${fundCash.asOfDate}.`
                    : "You have never confirmed a bank balance."}{" "}
                  This figure is derived from your ledgers, not measured against the bank &mdash; check the statement,
                  or type the real balance.
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
            <div>
              <HoverDetail
                detailClassName="w-[22rem]"
                detail={
                  <div className="space-y-1.5">
                    <p className="text-foreground text-sm font-medium">Equity gross assets</p>
                    <dl className="space-y-1 text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">Equity share of platforms</dt>
                        <dd className="tabular-nums">{formatMoney(equityPlatformValue)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">Equity share of cash</dt>
                        <dd className="tabular-nums">{formatMoney(attribution?.equity ?? 0)}</dd>
                      </div>
                    </dl>
                    {staleRows.length > 0 && (
                      <p className="text-muted-foreground text-xs">
                        {staleRows.length} platform{staleRows.length === 1 ? "" : "s"} carried forward.
                      </p>
                    )}
                  </div>
                }
              >
                <div className="text-sm">
                  <span className="text-muted-foreground">Equity gross assets </span>
                  <span className="font-semibold tabular-nums underline decoration-dotted underline-offset-4">
                    {formatMoney(grossAssets)}
                  </span>
                  {/* The total and the weights are what the round-trip is
                      re-deriving, so the wait is reported on them rather than
                      by blanking the table the admin is typing into. */}
                  {previewLoading && rows.length > 0 && (
                    <span className="text-muted-foreground ml-2 text-xs" aria-live="polite">
                      updating&hellip;
                    </span>
                  )}
                </div>
              </HoverDetail>
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
