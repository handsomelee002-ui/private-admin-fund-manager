"use client";

import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoney } from "@/lib/formatting";
import { AlertTriangle } from "lucide-react";

export type CashPool = {
  key: string;
  label: string;
  claim: number;
  deployed: number;
  available: number;
  /**
   * Principal this pool has deployed that its claim does not credit. Non-zero
   * means `available` is arithmetic without meaning, so no figure is shown.
   */
  unbackedPrincipal?: number;
  /** Tailwind text/bg pair for the pool's accent colour. */
  text: string;
  bg: string;
};

export type CashPoolsProps = {
  pools: CashPool[];
  bankBalance: number;
  asOfDate: string;
  fundCashRecorded: boolean;
};

function deployedPercent(pool: CashPool) {
  const total = pool.deployed + Math.max(pool.available, 0);
  if (total <= 0) return 0;
  return Math.min(100, (pool.deployed / total) * 100);
}

/**
 * One pool tile. Detail opens on hover for pointer users and on click for
 * everyone else - hover alone is unreachable on touch.
 *
 * Deliberately does NOT open on focus. Base UI returns focus to the trigger when
 * the popup closes, so a focus handler re-opens it the instant it shuts and the
 * popup can never be dismissed. Keyboard users open it with Enter or Space,
 * which Popover.Trigger already handles as a button.
 */
function PoolTile({ pool }: { pool: CashPool }) {
  const [open, setOpen] = useState(false);
  // Closing on mouseleave immediately makes the popup unreachable, since moving
  // the pointer towards it briefly leaves the trigger.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function closeSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  const unreliable = (pool.unbackedPrincipal ?? 0) > 0;
  const percent = deployedPercent(pool);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        className="group flex w-full flex-col gap-2 rounded-lg border border-border/50 bg-background/40 p-3 text-left transition-colors hover:border-border hover:bg-background/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{pool.label}</span>
          {unreliable && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
        </div>

        {unreliable ? (
          // A figure that cannot be trusted is worse than no figure: shown, it
          // reads as a balance. The popup carries the explanation.
          <span className="text-2xl font-bold leading-8 text-muted-foreground">&mdash;</span>
        ) : (
          <span className={`text-2xl font-bold leading-8 tabular-nums ${pool.available < 0 ? "text-red-400" : pool.text}`}>
            {formatMoney(pool.available)}
          </span>
        )}

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
          <div
            className={unreliable ? "h-full bg-muted-foreground/40" : `h-full ${pool.bg}`}
            style={{ width: `${unreliable ? 100 : percent}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">
          {unreliable ? "Not available - see details" : `${percent.toFixed(0)}% deployed`}
        </span>
      </PopoverTrigger>

      <PopoverContent onMouseEnter={openNow} onMouseLeave={closeSoon} className="space-y-3">
        <div>
          <p className="text-sm font-semibold">{pool.label}</p>
          <p className="text-xs text-muted-foreground">Cash this pool can still deploy.</p>
        </div>

        <dl className="space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Owned</dt>
            <dd className="font-medium tabular-nums">{formatMoney(pool.claim)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Deployed in platforms</dt>
            <dd className="font-medium tabular-nums">&minus; {formatMoney(pool.deployed)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border/50 pt-1.5">
            <dt className="font-medium">Available</dt>
            <dd className={`font-bold tabular-nums ${unreliable ? "text-muted-foreground" : pool.available < 0 ? "text-red-400" : pool.text}`}>
              {formatMoney(pool.available)}
            </dd>
          </div>
        </dl>

        {unreliable && (
          <p className="rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-400/90">
            Treat this as unknown, not as an overdraft. {formatMoney(pool.unbackedPrincipal ?? 0)} of principal is
            deployed under this funding source, but the brokerage claim is built from earnings only and has no term for
            principal the pot contributed. Owned and deployed are not on the same ledger, so subtracting them is
            arithmetic without meaning.
          </p>
        )}

        {!unreliable && pool.available < 0 && (
          <p className="rounded-md border border-red-400/30 bg-red-400/5 px-2.5 py-2 text-[11px] leading-relaxed text-red-400/90">
            This pool owes more than the bank is holding for it.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function AvailableCashPools({ pools, bankBalance, asOfDate, fundCashRecorded }: CashPoolsProps) {
  // Sized only from pools that hold cash: a negative share cannot be a segment
  // of a positive bar, and a pool with no trustworthy figure has no share.
  const barPools = pools.filter((pool) => (pool.unbackedPrincipal ?? 0) === 0 && pool.available > 0);
  const barTotal = barPools.reduce((sum, pool) => sum + pool.available, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-muted-foreground">
          Available = owned &minus; deployed. Together they make up the bank balance.
        </p>
        <p className="text-xs text-muted-foreground">
          {fundCashRecorded ? `As of ${asOfDate}` : "Bank balance never recorded"}
        </p>
      </div>

      {barTotal > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
          {barPools.map((pool) => (
            <div
              key={pool.key}
              className={pool.bg}
              style={{ width: `${(pool.available / barTotal) * 100}%` }}
              title={`${pool.label}: ${formatMoney(pool.available)} available`}
            />
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {pools.map((pool) => (
          <PoolTile key={pool.key} pool={pool} />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Bank balance {formatMoney(bankBalance)}. Hover or tap a pool for its breakdown.
      </p>
    </div>
  );
}
