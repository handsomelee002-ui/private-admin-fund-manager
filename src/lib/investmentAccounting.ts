import { roundMoney } from "@/lib/accounting";

export const BASE_CURRENCY = "MYR";

export const INVESTMENT_TRANSACTION_TYPES = [
  "TRANSFER",
  "FX_CONVERSION",
  "BROKER_DEPOSIT",
  "BROKER_WITHDRAWAL",
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "TAX",
  "CORPORATE_ACTION",
  "ADJUSTMENT",
] as const;

export type InvestmentTransactionType = (typeof INVESTMENT_TRANSACTION_TYPES)[number];

export function isInvestmentTransactionType(value: string): value is InvestmentTransactionType {
  return INVESTMENT_TRANSACTION_TYPES.includes(value as InvestmentTransactionType);
}

export function signedCashFlow(type: string, baseAmount: number) {
  if (["BROKER_DEPOSIT", "TRANSFER", "BUY", "FEE", "TAX"].includes(type)) return -Math.abs(baseAmount);
  if (["BROKER_WITHDRAWAL", "SELL", "DIVIDEND", "INTEREST"].includes(type)) return Math.abs(baseAmount);
  return baseAmount;
}

function npv(rate: number, cashFlows: { date: Date; amount: number }[]) {
  const start = cashFlows[0]?.date;
  if (!start) return 0;
  return cashFlows.reduce((sum, cashFlow) => {
    const years = (cashFlow.date.getTime() - start.getTime()) / (365 * 24 * 60 * 60 * 1000);
    return sum + cashFlow.amount / Math.pow(1 + rate, years);
  }, 0);
}

export function calculateXirr(cashFlows: { date: string; amount: number }[]) {
  const datedFlows = cashFlows
    .filter((cashFlow) => Number.isFinite(cashFlow.amount) && cashFlow.amount !== 0)
    .map((cashFlow) => ({ date: new Date(`${cashFlow.date}T00:00:00Z`), amount: cashFlow.amount }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!datedFlows.some((flow) => flow.amount < 0) || !datedFlows.some((flow) => flow.amount > 0)) {
    return null;
  }

  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low, datedFlows);
  let highValue = npv(high, datedFlows);

  for (let expansion = 0; lowValue * highValue > 0 && expansion < 20; expansion += 1) {
    high *= 2;
    highValue = npv(high, datedFlows);
  }

  if (lowValue * highValue > 0) return null;

  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const midValue = npv(mid, datedFlows);
    if (Math.abs(midValue) < 0.000001) return mid;
    if (lowValue * midValue < 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }

  return (low + high) / 2;
}

export function percentage(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return roundMoney((numerator / denominator) * 100);
}
