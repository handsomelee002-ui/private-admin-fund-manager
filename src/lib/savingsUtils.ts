/**
 * Compute daily-compounded interest earned from a single deposit up to today.
 *   A = P × (1 + r/365)^d  – P
 * where r = annual rate as a decimal, d = whole days elapsed since deposit date.
 */
export function calcDailyCompoundInterest(
  principal: number,
  annualRatePct: number,
  depositDateStr: string,
): number {
  if (annualRatePct <= 0 || principal <= 0) return 0;
  const r = annualRatePct / 100;
  const start = new Date(depositDateStr);
  const today = new Date();
  // Use UTC midnight for both to avoid DST issues
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.floor((todayUtc - startUtc) / 86_400_000);
  if (days <= 0) return 0;
  return principal * (Math.pow(1 + r / 365, days) - 1);
}
