import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const metricHeaderClass = "flex min-h-12 flex-row items-start justify-between gap-3 pb-2";
const metricTitleClass = "text-sm leading-5 text-muted-foreground";
const metricValueClass = "text-[1.625rem] leading-8 font-bold whitespace-nowrap tabular-nums tracking-normal";

export type MetricRow = {
  label: string;
  value: string;
  /** Accent for the value, e.g. a pool's colour or a negative red. */
  valueClassName?: string;
  /** Native tooltip for a label whose short form could be read two ways. */
  hint?: string;
};

export type MetricCardProps = {
  title: string;
  icon: ReactNode;
  value: string;
  valueClassName?: string;
  /** The signed change line that sits directly under the headline figure. */
  delta?: ReactNode;
  /** Related figures, ruled off under the headline. Empty for a bare card. */
  rows: MetricRow[];
  /** Provenance - the date or definition behind the card. Omit when the rows
   *  already say it. */
  footnote?: string;
};

/**
 * One dashboard metric, with the breakdown printed rather than hidden behind a
 * hover. Every card is the same shape - title, headline, ruled-off rows,
 * footnote - so the four read as one table rather than four widgets.
 */
export function MetricCard({ title, icon, value, valueClassName, delta, rows, footnote }: MetricCardProps) {
  return (
    <Card className="h-full bg-card/50 border-border/50">
      <CardHeader className={metricHeaderClass}>
        <CardTitle className={metricTitleClass}>{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className={cn(metricValueClass, valueClassName)}>{value}</div>
          {/* Cards without a delta still reserve its line, so the rule below
           *  and every row under it land at the same height on all cards. */}
          {delta ?? (
            <p className="text-xs mt-1 invisible" aria-hidden="true">
              &nbsp;
            </p>
          )}
        </div>

        {rows.length > 0 && (
          <dl className="space-y-1.5 border-t border-border/50 pt-2.5 text-xs">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground" title={row.hint}>
                  {row.label}
                </dt>
                <dd className={cn("shrink-0 font-medium tabular-nums", row.valueClassName)}>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {footnote && <p className="text-[11px] text-muted-foreground/70">{footnote}</p>}
      </CardContent>
    </Card>
  );
}
