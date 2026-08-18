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
  const availableRounded = roundUnits(units);
  // Silently capping the redemption would report success for a withdrawal that
  // only partly happened. Reject instead, matching the fixed-savings guard.
  if (requestedUnits > availableRounded + 1e-6) {
    const maximum = roundMoney(availableRounded * nav);
    throw new Error(
      `Withdrawal of RM ${roundMoney(amount).toFixed(2)} exceeds the investor's redeemable equity of RM ${maximum.toFixed(2)}. Use "withdraw all" to redeem the full balance.`,
    );
  }
  const unitsRedeemed = Math.min(requestedUnits, availableRounded);
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

function calculateBrokerageFundingAllocation({
  equityNetInvested,
  fixedSavingsNetInvested,
  brokerageNetInvested = 0,
  totalValue,
}) {
  const equity = roundMoney(Number(equityNetInvested) || 0);
  const fixedSavings = roundMoney(Number(fixedSavingsNetInvested) || 0);
  const brokerage = roundMoney(Number(brokerageNetInvested) || 0);
  const value = roundMoney(Number(totalValue) || 0);
  const totalNetInvested = roundMoney(equity + fixedSavings + brokerage);
  const profitLoss = roundMoney(value - totalNetInvested);
  const equityRatio = totalNetInvested > 0 ? roundMoney((equity / totalNetInvested) * 100) : 0;
  const fixedSavingsRatio = totalNetInvested > 0 ? roundMoney((fixedSavings / totalNetInvested) * 100) : 0;
  const brokerageRatio = totalNetInvested > 0 ? roundMoney((brokerage / totalNetInvested) * 100) : 0;
  const equityProfitLoss = roundMoney(profitLoss * (equityRatio / 100));
  const fixedSavingsProfitLoss = roundMoney(profitLoss * (fixedSavingsRatio / 100));
  const businessProfitLoss = roundMoney(profitLoss - equityProfitLoss);

  return {
    totalNetInvested,
    profitLoss,
    equityRatio,
    fixedSavingsRatio,
    brokerageRatio,
    equityNetInvested: equity,
    fixedSavingsNetInvested: fixedSavings,
    brokerageNetInvested: brokerage,
    equityProfitLoss,
    fixedSavingsProfitLoss,
    brokerageProfitLoss: businessProfitLoss,
    equityNavValue: roundMoney(equity + equityProfitLoss),
  };
}

function allocateFixedSavingsWithdrawal({ accounts, amount, interestBalance }) {
  const requested = roundMoney(Number(amount) || 0);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error("Withdrawal amount must be positive.");
  }
  const allocations = [];
  let remaining = requested;
  const availableInterest = roundMoney(Number(interestBalance) || 0);
  const interest = interestBalance === undefined ? 0 : roundMoney(Math.min(Math.max(availableInterest, 0), remaining));
  remaining = roundMoney(remaining - interest);

  for (const account of accounts) {
    if (remaining <= 0) break;
    const balance = roundMoney(Number(account.balance) || 0);
    if (balance <= 0) continue;
    const withdrawal = roundMoney(Math.min(balance, remaining));
    allocations.push({ id: account.id, amount: withdrawal });
    remaining = roundMoney(remaining - withdrawal);
  }

  if (remaining > 0.001) {
    throw new Error("Withdrawal exceeds available fixed savings balance.");
  }

  if (interestBalance === undefined) return allocations;

  return {
    principal: allocations,
    interest,
  };
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
  allocateFixedSavingsWithdrawal,
  calculateBrokerageFundingAllocation,
  calculateNavPerUnit,
  calculateOwnershipPercent,
  issueUnitsForDeposit,
  redeemUnitsForWithdrawal,
  roundMoney,
  roundUnits,
};
