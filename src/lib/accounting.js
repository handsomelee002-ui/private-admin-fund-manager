function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function roundMoney(value) {
  return roundTo(value, 2);
}

function roundUnits(value) {
  return roundTo(value, 6);
}

function calculateNavPerUnit({ netAssetValue, totalUnits }) {
  const units = Number(totalUnits);
  if (!Number.isFinite(units) || units <= 0) return 1;
  const nav = Number(netAssetValue) / units;
  if (!Number.isFinite(nav) || nav <= 0) {
    throw new Error("NAV per unit must be positive.");
  }
  return roundUnits(nav);
}

function issueUnitsForDeposit({ amount, navPerUnit }) {
  const cash = Number(amount);
  const nav = Number(navPerUnit);
  if (!Number.isFinite(cash) || cash <= 0) {
    throw new Error("Deposit amount must be positive.");
  }
  if (!Number.isFinite(nav) || nav <= 0) {
    throw new Error("NAV per unit must be positive.");
  }
  return roundUnits(cash / nav);
}

function redeemUnitsForWithdrawal({ requestedAmount, navPerUnit, availableUnits }) {
  const amount = Number(requestedAmount);
  const nav = Number(navPerUnit);
  const units = Number(availableUnits);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Withdrawal amount must be positive.");
  }
  if (!Number.isFinite(nav) || nav <= 0) {
    throw new Error("NAV per unit must be positive.");
  }
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error("No units available to redeem.");
  }

  const requestedUnits = roundUnits(amount / nav);
  const unitsRedeemed = Math.min(requestedUnits, roundUnits(units));
  return {
    unitsRedeemed,
    grossAmount: roundMoney(unitsRedeemed * nav),
  };
}

function calculateOwnershipPercent({ investorUnits, totalUnits }) {
  const investor = Number(investorUnits);
  const total = Number(totalUnits);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return roundUnits((investor / total) * 100);
}

function wholeDaysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date.");
  }
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function accrueDailyCompoundInterest({ principal, annualRatePercent, startDate, endDate }) {
  const amount = Number(principal);
  const rate = Number(annualRatePercent);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const days = wholeDaysBetween(startDate, endDate);
  const accrued = amount * (1 + rate / 100 / 365) ** days - amount;
  return roundMoney(accrued);
}

module.exports = {
  accrueDailyCompoundInterest,
  calculateNavPerUnit,
  calculateOwnershipPercent,
  issueUnitsForDeposit,
  redeemUnitsForWithdrawal,
  roundMoney,
  roundUnits,
};
