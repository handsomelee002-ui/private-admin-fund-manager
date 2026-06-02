import {
  calculateXirr,
  INVESTMENT_TRANSACTION_TYPES,
  percentage,
  signedCashFlow,
} from "@/lib/investmentAccounting";

export function calculatePlatformPerformance(transactions: any[], snapshots: any[]) {
  const activeSettled = transactions.filter((transaction: any) => transaction.audit_status === "active" && transaction.status === "SETTLED");
  const totalDeposits = activeSettled.reduce((sum: number, transaction: any) => {
    return ["BROKER_DEPOSIT", "Deposit"].includes(transaction.type) ? sum + parseFloat(transaction.base_amount || transaction.amount || "0") : sum;
  }, 0);
  const totalWithdrawals = activeSettled.reduce((sum: number, transaction: any) => {
    return ["BROKER_WITHDRAWAL", "Withdraw"].includes(transaction.type) ? sum + parseFloat(transaction.base_amount || transaction.amount || "0") : sum;
  }, 0);
  const realizedProfit = activeSettled.reduce((sum: number, transaction: any) => sum + parseFloat(transaction.realized_profit || "0"), 0);
  const netInvested = totalDeposits - totalWithdrawals;
  const latestSnapshot = snapshots[0];
  const snapshotTotalValue = latestSnapshot ? parseFloat(latestSnapshot.total_value || "0") : 0;
  const latestUnrealized = latestSnapshot
    ? snapshotTotalValue > 0
      ? snapshotTotalValue - netInvested
      : parseFloat(latestSnapshot.unrealized_profit || "0")
    : 0;
  const currentValue = snapshotTotalValue > 0 ? snapshotTotalValue : netInvested + latestUnrealized;
  const simpleRoi = percentage(currentValue + totalWithdrawals - totalDeposits, totalDeposits);
  const cashFlows = activeSettled
    .filter((transaction: any) => ["BROKER_DEPOSIT", "BROKER_WITHDRAWAL", "Deposit", "Withdraw"].includes(transaction.type))
    .map((transaction: any) => ({
      date: transaction.date,
      amount: signedCashFlow(transaction.type, parseFloat(transaction.base_amount || transaction.amount || "0")),
    }));
  if (currentValue !== 0) {
    cashFlows.push({ date: new Date().toISOString().slice(0, 10), amount: currentValue });
  }

  return {
    totalDeposits,
    totalWithdrawals,
    netInvested,
    currentValue,
    realizedProfit,
    latestUnrealized,
    simpleRoi,
    xirr: calculateXirr(cashFlows),
    transactionTypes: INVESTMENT_TRANSACTION_TYPES,
  };
}
