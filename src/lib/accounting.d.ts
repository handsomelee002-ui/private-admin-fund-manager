export function roundMoney(value: number): number;
export function roundUnits(value: number): number;
export function calculateNavPerUnit(input: { netAssetValue: number; totalUnits: number }): number;
export function issueUnitsForDeposit(input: { amount: number; navPerUnit: number }): number;
export function redeemUnitsForWithdrawal(input: {
  requestedAmount: number;
  navPerUnit: number;
  availableUnits: number;
}): { unitsRedeemed: number; grossAmount: number };
export function calculateOwnershipPercent(input: { investorUnits: number; totalUnits: number }): number;
export function calculateBrokerageFundingAllocation(input: {
  equityNetInvested: number;
  fixedSavingsNetInvested: number;
  brokerageNetInvested?: number;
  totalValue: number;
}): {
  totalNetInvested: number;
  profitLoss: number;
  equityRatio: number;
  fixedSavingsRatio: number;
  brokerageRatio: number;
  equityNetInvested: number;
  fixedSavingsNetInvested: number;
  brokerageNetInvested: number;
  equityProfitLoss: number;
  fixedSavingsProfitLoss: number;
  brokerageProfitLoss: number;
  equityNavValue: number;
};
export function allocateFixedSavingsWithdrawal(input: {
  accounts: { id: string; balance: number }[];
  amount: number;
  interestBalance?: undefined;
}): { id: string; amount: number }[];
export function allocateFixedSavingsWithdrawal(input: {
  accounts: { id: string; balance: number }[];
  amount: number;
  interestBalance: number;
}): { principal: { id: string; amount: number }[]; interest: number };
export function accrueDailyCompoundInterest(input: {
  principal: number;
  annualRatePercent: number;
  startDate: string;
  endDate: string;
}): number;
