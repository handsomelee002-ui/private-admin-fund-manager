export type ValuationSource = "RECORDED" | "CARRIED_FORWARD" | "NET_INVESTED_FALLBACK" | "CLOSED";

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
}): ResolvedValuation;
export function blockingValuations<T extends ResolvedValuation>(
  resolved: T[],
  fundCash?: number,
): (T & { weightPercent: number })[];
