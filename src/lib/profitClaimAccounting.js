function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateClaimSettlement({
  lockedAmount,
  previousSettledAmount,
  brokerageFee,
  requestedSettlementAmount,
}) {
  const locked = roundMoney(lockedAmount);
  const previousSettled = roundMoney(previousSettledAmount);
  const fee = roundMoney(brokerageFee);
  const requested = roundMoney(requestedSettlementAmount);
  const netPayable = roundMoney(locked - fee);
  const remainingNet = roundMoney(Math.max(0, netPayable - previousSettled));
  const cappedAmount = roundMoney(Math.min(requested, remainingNet));

  if (cappedAmount <= 0) {
    const alreadySettled = previousSettled >= netPayable - 0.005;
    return {
      cappedAmount: 0,
      finalSettledAmount: previousSettled,
      isFullySettled: alreadySettled,
      ledgerAmount: 0,
      netPayable,
      status: alreadySettled ? "settled" : "partial",
    };
  }

  const newSettled = roundMoney(previousSettled + cappedAmount);
  const isFullySettled = newSettled >= netPayable - 0.005;
  const finalSettledAmount = isFullySettled ? netPayable : newSettled;

  return {
    cappedAmount,
    finalSettledAmount,
    isFullySettled,
    ledgerAmount: cappedAmount,
    netPayable,
    status: isFullySettled ? "settled" : "partial",
  };
}

module.exports = {
  calculateClaimSettlement,
};
