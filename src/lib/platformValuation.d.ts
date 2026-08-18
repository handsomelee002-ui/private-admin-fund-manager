export type TrackingMode = "CASHFLOW" | "POSITION";

export type ValuationSource =
  | "COMPUTED"
  | "RECORDED"
  | "CARRIED_FORWARD"
  | "RECORDED_FALLBACK"
  | "NET_INVESTED_FALLBACK";

export type RecordedValuation = {
  asOfDate: string;
  totalValue: number;
};

export type Holding = {
  symbol: string;
  quantity: number;
  latestPrice: number;
  fxRateToBase?: number;
};

export type ResolvedValuation = {
  totalValue: number;
  source: ValuationSource;
  valuationDate: string | null;
  ageDays: number | null;
  isStale: boolean;
  missingPrices: string[];
};

export declare const TRACKING_MODES: readonly TrackingMode[];
export declare const STALE_AFTER_DAYS: number;
export declare const MATERIAL_WEIGHT_PERCENT: number;

export function isTrackingMode(value: string): value is TrackingMode;
export function daysBetween(startDate: string, endDate: string): number;
export function selectValuationAsOf(
  valuations: RecordedValuation[],
  asOfDate: string,
): RecordedValuation | null;
export function valueFromHoldings(input: {
  holdings: Holding[];
  cashBalance: number;
}): { totalValue: number | null; missingPrices: string[] };
export function resolvePlatformValue(input: {
  trackingMode: TrackingMode;
  netInvested: number;
  valuations?: RecordedValuation[];
  holdings?: Holding[] | null;
  cashBalance?: number;
  asOfDate: string;
}): ResolvedValuation;
export function blockingValuations<T extends ResolvedValuation>(
  resolved: T[],
): (T & { weightPercent: number })[];
