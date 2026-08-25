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
  equityContributed,
  fixedSavingsContributed,
  brokerageContributed,
}) {
  const equity = roundMoney(Number(equityNetInvested) || 0);
  const fixedSavings = roundMoney(Number(fixedSavingsNetInvested) || 0);
  const brokerage = roundMoney(Number(brokerageNetInvested) || 0);
  const value = roundMoney(Number(totalValue) || 0);
  const totalNetInvested = roundMoney(equity + fixedSavings + brokerage);
  const profitLoss = roundMoney(value - totalNetInvested);

  // Profit is split by who funded the platform. Net invested is the basis while
  // it is positive. Once principal has been withdrawn it can reach zero or go
  // negative, leaving no basis - then fall back to gross contributions, because
  // ownership of the remaining gain is decided by who put money in, not by what
  // is left after withdrawals. Zeroing the ratios instead would drop the
  // platform's value out of NAV entirely.
  const contributed = {
    equity: roundMoney(Number(equityContributed) || 0),
    fixedSavings: roundMoney(Number(fixedSavingsContributed) || 0),
    brokerage: roundMoney(Number(brokerageContributed) || 0),
  };
  const contributedTotal = roundMoney(contributed.equity + contributed.fixedSavings + contributed.brokerage);

  let basis;
  if (totalNetInvested > 0) {
    basis = { equity, fixedSavings, brokerage, total: totalNetInvested };
  } else if (contributedTotal > 0) {
    basis = { ...contributed, total: contributedTotal };
  } else {
    // Nothing recorded either way: attribute to equity rather than discarding.
    basis = { equity: 1, fixedSavings: 0, brokerage: 0, total: 1 };
  }

  // Ratios are rounded for display only. Splitting the money by the *rounded*
  // percentage let the shares drift from the total on large balances, so the
  // shares are taken from the exact fractions and the residual is carried by
  // the non-equity side, which keeps the parts summing to the whole.
  const equityRatio = roundMoney((basis.equity / basis.total) * 100);
  const fixedSavingsRatio = roundMoney((basis.fixedSavings / basis.total) * 100);
  const brokerageRatio = roundMoney((basis.brokerage / basis.total) * 100);
  const equityProfitLoss = roundMoney(profitLoss * (basis.equity / basis.total));
  const fixedSavingsProfitLoss = roundMoney(profitLoss * (basis.fixedSavings / basis.total));
  // Everything not attributed to equity: the fixed-savings and brokerage shares
  // together. This is the fund's "non-equity investment P&L" and is what the
  // brokerage reconciliation reads - do not add fixedSavingsProfitLoss to it.
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

/**
 * Split the fund's bank balance between the pools with a claim on it.
 *
 * Equity is the residual owner: savers hold a fixed contractual claim, the
 * brokerage pot holds what it has earned and not yet spent, and equity owns the
 * remainder. Counting the whole balance as equity - which this replaces - priced
 * savers' money into the unit price.
 *
 * `nonEquityValueInPlatforms` is needed because the other pools hold part of
 * their claim as platform value rather than cash. Without it their deployed
 * capital would be deducted from cash it is no longer sitting in.
 *
 * The brokerage claim must be built from *cumulative* interest and bonuses, not
 * outstanding ones: an obligation already paid in cash has left the bank, so
 * treating it as no longer owed would return the money to equity twice.
 */
function calculateEquityFundCash({
  bankBalance,
  nonEquityValueInPlatforms,
  fixedSavingsLiability,
  nonEquityPlatformProfitLoss,
  performanceFees,
  cumulativeFixedSavingsInterest,
  cumulativeFixedSavingsBonuses,
  cumulativeEquityBonuses,
}) {
  const bank = roundMoney(Number(bankBalance) || 0);
  const nonEquityInPlatforms = roundMoney(Number(nonEquityValueInPlatforms) || 0);
  const savers = roundMoney(Number(fixedSavingsLiability) || 0);
  const brokerageClaim = roundMoney(
    (Number(nonEquityPlatformProfitLoss) || 0)
      + (Number(performanceFees) || 0)
      - (Number(cumulativeFixedSavingsInterest) || 0)
      - (Number(cumulativeFixedSavingsBonuses) || 0)
      - (Number(cumulativeEquityBonuses) || 0),
  );

  return {
    bankBalance: bank,
    nonEquityValueInPlatforms: nonEquityInPlatforms,
    fixedSavingsLiability: savers,
    brokerageClaim,
    equity: roundMoney(bank + nonEquityInPlatforms - savers - brokerageClaim),
  };
}

/**
 * How much cash each pool still has free to deploy, as opposed to how much it
 * owns in total.
 *
 * `calculateEquityFundCash` answers "who owns the bank balance". This answers
 * the operator's question instead: if I fund a platform from fixed savings
 * today, how much is actually there? A pool's claim includes capital already
 * sitting in a platform, so available = claim - deployed.
 *
 * Savers are charged only their *principal* in platforms, not its profit share.
 * Their claim is contractual - a fixed rate - so profit earned on their money
 * accrues to the brokerage pot, which is why `calculateEquityFundCash` folds the
 * whole non-equity profit into `brokerageClaim`. Charging savers for value they
 * do not own would understate their free cash and overstate the pot's.
 *
 * Equity is computed as the **residual**, not independently: it is the residual
 * claimant on the bank balance, so whatever the other two do not hold is its.
 * Deriving it this way makes "the three add up to the bank balance" true by
 * construction rather than by two formulas happening to agree - which they did
 * not, once the pot's balance moved to the locked-NAV basis.
 */
function splitPoolAvailability({
  bankBalance,
  equityValueInPlatforms,
  fixedSavingsLiability,
  fixedSavingsPrincipalInPlatforms,
  brokerageBalance,
  brokerageDeployedInPlatforms,
}) {
  const bank = roundMoney(Number(bankBalance) || 0);
  const equityDeployed = roundMoney(Number(equityValueInPlatforms) || 0);
  const savers = roundMoney(Number(fixedSavingsLiability) || 0);
  const saversDeployed = roundMoney(Number(fixedSavingsPrincipalInPlatforms) || 0);
  const pot = roundMoney(Number(brokerageBalance) || 0);
  const potDeployed = roundMoney(Number(brokerageDeployedInPlatforms) || 0);

  const saversAvailable = roundMoney(savers - saversDeployed);
  const potAvailable = roundMoney(pot - potDeployed);
  const equityAvailable = roundMoney(bank - saversAvailable - potAvailable);

  return {
    bankBalance: bank,
    equity: {
      claim: roundMoney(equityDeployed + equityAvailable),
      deployed: equityDeployed,
      available: equityAvailable,
    },
    fixedSavings: {
      claim: savers,
      deployed: saversDeployed,
      available: saversAvailable,
    },
    brokerage: {
      claim: pot,
      deployed: potDeployed,
      available: potAvailable,
    },
  };
}

/**
 * Turn a list of amounts into percentage shares that add to exactly 100.
 *
 * Rounding each share independently lets the parts sum to 99.99 or 100.01, which
 * looks like a bug in a pie chart legend. The last non-zero share carries the
 * residual instead - the same trick calculateBrokerageFundingAllocation uses to
 * keep split money summing to the whole.
 *
 * Returns all zeros when nothing has value, rather than dividing by zero.
 * Negative amounts are treated as zero: a share of a total cannot be negative.
 */
function allocateSharePercentages(values) {
  const amounts = values.map((value) => Math.max(0, Number(value) || 0));
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return amounts.map(() => 0);

  const lastNonZero = amounts.reduce((last, amount, index) => (amount > 0 ? index : last), -1);
  let allocated = 0;
  return amounts.map((amount, index) => {
    if (amount <= 0) return 0;
    const percent = index === lastNonZero
      ? roundMoney(100 - allocated)
      : roundMoney((amount / total) * 100);
    allocated = roundMoney(allocated + percent);
    return percent;
  });
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

/**
 * Realised non-equity profit on one platform, from its cash flows alone.
 *
 * The fund never sees the underlying trades on a copy-trading, high-frequency
 * or crypto account - only money paid into the broker, money swept back out,
 * and a periodic mark. So the only realisation event it can observe is cash
 * returning to the fund's bank. Everything still sitting at the broker is still
 * being traded, and is therefore still unrealised however many trades closed to
 * produce it.
 *
 * Return of capital first: sweeps repay principal before they realise anything.
 * The measure is the *lowest* point cumulative net invested ever reached, not
 * where it sits today, so topping the account back up cannot un-realise a gain
 * already taken off the table.
 *
 * `flows` are signed and in date order - positive into the platform, negative
 * out. `closed` means the account is shut and marked at zero, so nothing is
 * left to recover and whatever never came back is a realised loss.
 */
function realisedNonEquityProfit({ flows = [], closed = false }) {
  let running = 0;
  let lowest = 0;
  for (const flow of flows) {
    running = roundMoney(running + (Number(flow) || 0));
    if (running < lowest) lowest = running;
  }
  // A shut account has no unrealised part left, so realised must equal the
  // whole return: value (zero) less net invested, which is exactly -running.
  if (closed) return roundMoney(-running);
  return roundMoney(Math.max(0, -lowest));
}

/**
 * Split the pot's non-equity P&L into the part that has been converted to cash
 * and the part that is still a mark.
 *
 * `total` is passed in on the locked-NAV basis and is not recomputed here: the
 * unrealised half is deliberately derived as the residual, so the two always
 * add back to the number NAV priced itself on. Deriving it independently is how
 * a split stops reconciling.
 */
function splitNonEquityProfit({ platforms = [], totalProfitLoss = 0 }) {
  const total = roundMoney(Number(totalProfitLoss) || 0);
  const realised = roundMoney(
    platforms.reduce((sum, platform) => sum + realisedNonEquityProfit(platform), 0),
  );
  return { realised, unrealised: roundMoney(total - realised), total };
}

module.exports = {
  accrueDailyCompoundInterest,
  calculateEquityFundCash,
  realisedNonEquityProfit,
  splitNonEquityProfit,
  splitPoolAvailability,
  allocateSharePercentages,
  allocateFixedSavingsWithdrawal,
  calculateBrokerageFundingAllocation,
  calculateNavPerUnit,
  calculateOwnershipPercent,
  issueUnitsForDeposit,
  redeemUnitsForWithdrawal,
  roundMoney,
  roundUnits,
};
