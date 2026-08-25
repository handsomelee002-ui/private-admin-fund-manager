import { formatMoney } from "@/lib/formatting";
import { cn } from "@/lib/utils";

export type CashPool = {
  key: string;
  label: string;
  /** What the pool owns: deployed plus available. */
  claim: number;
  deployed: number;
  available: number;
  /** Tailwind text colour for the pool's accent. */
  text: string;
};

function SectionLabel({ children }: { children: string }) {
  return <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{children}</p>;
}

/**
 * The full derivation behind the Available Cash headline.
 *
 * The bank reconciliation is the part that cannot be shown on the card itself:
 * equity available is not measured, it is what is left of the bank once the
 * savers' and the pot's undeployed cash is set aside (see splitPoolAvailability
 * in accounting.js). Naming the pot here is what makes the bank total add up -
 * the pot's earnings sit in the same bank account but cannot fund a platform.
 */
export function AvailableCashDetail({
  pools,
  bankBalance,
  brokerageAvailable,
  asOf,
}: {
  pools: CashPool[];
  bankBalance: number;
  brokerageAvailable: number;
  asOf: string;
}) {
  const fixedSavingsAvailable = pools.find((pool) => pool.key === "fixed_savings")?.available ?? 0;
  const equityAvailable = pools.find((pool) => pool.key === "equity")?.available ?? 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Available Cash</p>
        <p className="text-xs text-muted-foreground">What each pool can still deploy into a platform.</p>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1.5 text-xs">
        <span />
        <span className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/70">Owned</span>
        <span className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/70">Deployed</span>
        <span className="text-right text-[10px] uppercase tracking-wider text-muted-foreground/70">Available</span>

        {pools.map((pool) => (
          <div key={pool.key} className="contents">
            <span className="text-muted-foreground">{pool.label}</span>
            <span className="text-right tabular-nums">{formatMoney(pool.claim)}</span>
            <span className="text-right tabular-nums">{formatMoney(pool.deployed)}</span>
            <span
              className={cn("text-right font-medium tabular-nums", pool.available < 0 ? "text-red-400" : pool.text)}
            >
              {formatMoney(pool.available)}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <SectionLabel>Bank reconciliation</SectionLabel>
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Bank total</dt>
            <dd className="tabular-nums">{formatMoney(bankBalance)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">&minus; Fixed savings, undeployed</dt>
            <dd className="tabular-nums">{formatMoney(fixedSavingsAvailable)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">&minus; Brokerage pot, undeployed</dt>
            <dd className="tabular-nums">{formatMoney(brokerageAvailable)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">&minus; Equity available</dt>
            <dd className={cn("tabular-nums", equityAvailable < 0 && "text-red-400")}>
              {formatMoney(equityAvailable)}
            </dd>
          </div>
        </dl>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The bank is fully spoken for: every ringgit in it belongs to one of these three. Equity available is whatever
        is left once the savers&apos; and the pot&apos;s undeployed cash is set aside.
      </p>
      <p className="text-[10px] text-muted-foreground/70">{asOf}</p>
    </div>
  );
}
