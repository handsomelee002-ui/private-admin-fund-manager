export type ValuationSource =
  | "RECORDED"
  | "CARRIED_FORWARD"
  | "NAV_SNAPSHOT"
  | "NET_INVESTED_FALLBACK"
  | "CLOSED";

/** What a locked NAV last priced this platform at, when it has no mark of its own. */
export type NavSnapshotValuation = {
  weekEnding: string;
  totalValue: number;
};

export type RecordedValuation = {
  asOfDate: string;
  totalValue: number;
};

export type ResolvedValuation = {
  totalValue: number;
  source: ValuationSource;
  valuationDate: string | null;
  ageDays: number | null;
  isStale: boolean;
};

export declare const STALE_AFTER_DAYS: number;
export declare const MATERIAL_WEIGHT_PERCENT: number;

export function daysBetween(startDate: string, endDate: string): number;
export function selectValuationAsOf(
  valuations: RecordedValuation[],
  asOfDate: string,
): RecordedValuation | null;
export function resolvePlatformValue(input: {
  netInvested: number;
  valuations?: RecordedValuation[];
  asOfDate: string;
  /** The account is shut: worth nothing, and never stale. */
  closed?: boolean;
  /** Fallback ahead of cost: the value the last locked NAV recorded. */
  lastNavSnapshot?: NavSnapshotValuation | null;
}): ResolvedValuation;
export function blockingValuations<T extends ResolvedValuation>(
  resolved: T[],
  fundCash?: number,
): (T & { weightPercent: number })[];
