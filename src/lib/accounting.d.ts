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
  /**
   * Gross amounts contributed per funding source, ignoring withdrawals. Used as
   * the profit-split basis when net invested is no longer positive.
   */
  equityContributed?: number;
  fixedSavingsContributed?: number;
  brokerageContributed?: number;
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

export type FundCashAttributionResult = {
  bankBalance: number;
  nonEquityValueInPlatforms: number;
  fixedSavingsLiability: number;
  brokerageClaim: number;
  equity: number;
};

export function calculateEquityFundCash(input: {
  bankBalance: number;
  nonEquityValueInPlatforms: number;
  fixedSavingsLiability: number;
  nonEquityPlatformProfitLoss: number;
  performanceFees: number;
  cumulativeFixedSavingsInterest: number;
  cumulativeFixedSavingsBonuses: number;
  cumulativeEquityBonuses: number;
}): FundCashAttributionResult;
