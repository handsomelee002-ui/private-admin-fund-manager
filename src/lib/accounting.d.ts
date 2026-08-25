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

export type PoolAvailabilityPool = {
  /** Everything the pool owns, cash and deployed capital together. */
  claim: number;
  /** The part of that claim currently sitting in a platform. */
  deployed: number;
  /** Cash the pool still has free to deploy. */
  available: number;
};

export type PoolAvailabilityResult = {
  bankBalance: number;
  equity: PoolAvailabilityPool;
  fixedSavings: PoolAvailabilityPool;
  brokerage: PoolAvailabilityPool;
};

export function splitPoolAvailability(input: {
  bankBalance: number;
  equityValueInPlatforms: number;
  fixedSavingsLiability: number;
  fixedSavingsPrincipalInPlatforms: number;
  brokerageBalance: number;
  brokerageDeployedInPlatforms: number;
}): PoolAvailabilityResult;

export type NonEquityPlatformFlows = {
  /** Signed non-equity cash flows in date order: + into the platform, - out. */
  flows: number[];
  /** The account is shut and marked at zero, so nothing is left to recover. */
  closed?: boolean;
};

export function realisedNonEquityProfit(input: NonEquityPlatformFlows): number;

export function splitNonEquityProfit(input: {
  platforms: NonEquityPlatformFlows[];
  /** Total non-equity P&L on the locked-NAV basis. Unrealised is the residual. */
  totalProfitLoss: number;
}): { realised: number; unrealised: number; total: number };

/** Percentage shares of a total that always add to exactly 100. */
export function allocateSharePercentages(values: number[]): number[];

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
