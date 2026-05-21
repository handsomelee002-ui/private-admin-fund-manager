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
export function accrueDailyCompoundInterest(input: {
  principal: number;
  annualRatePercent: number;
  startDate: string;
  endDate: string;
}): number;
