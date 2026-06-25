export function calculateClaimSettlement(input: {
  lockedAmount: number;
  previousSettledAmount: number;
  brokerageFee: number;
  requestedSettlementAmount: number;
}): {
  cappedAmount: number;
  finalSettledAmount: number;
  isFullySettled: boolean;
  ledgerAmount: number;
  netPayable: number;
  status: "partial" | "settled";
};
