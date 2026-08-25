const assert = require("node:assert/strict");
const test = require("node:test");

const {
  accrueDailyCompoundInterest,
  calculateBrokerageFundingAllocation,
  realisedNonEquityProfit,
  splitNonEquityProfit,
  allocateFixedSavingsWithdrawal,
  calculateNavPerUnit,
  calculateOwnershipPercent,
  issueUnitsForDeposit,
  redeemUnitsForWithdrawal,
  roundMoney,
  roundUnits,
} = require("./accounting.js");

test("bootstraps NAV per unit to 1.000000 when no units exist", () => {
  assert.equal(calculateNavPerUnit({ netAssetValue: 25000, totalUnits: 0 }), 1);
});

test("calculates weekly NAV per unit from locked net assets and units", () => {
  assert.equal(calculateNavPerUnit({ netAssetValue: 125000, totalUnits: 100000 }), 1.25);
});

test("issues units for a deposit at the locked weekly NAV", () => {
  assert.equal(issueUnitsForDeposit({ amount: 5000, navPerUnit: 1.25 }), 4000);
});

test("redeems units for a withdrawal at the locked weekly NAV", () => {
  assert.deepEqual(
    redeemUnitsForWithdrawal({
      requestedAmount: 3125,
      navPerUnit: 1.25,
      availableUnits: 4000,
    }),
    { unitsRedeemed: 2500, grossAmount: 3125 },
  );
});

test("rejects a withdrawal larger than the investor's redeemable equity", () => {
  // Silently capping would report success for a withdrawal that only partly
  // happened; the caller must use withdrawAll to redeem the full balance.
  assert.throws(
    () =>
      redeemUnitsForWithdrawal({
        requestedAmount: 999999,
        navPerUnit: 1.25,
        availableUnits: 4000,
      }),
    /exceeds the investor's redeemable equity of RM 5000\.00/,
  );
});

test("allows redeeming the exact available balance", () => {
  assert.deepEqual(
    redeemUnitsForWithdrawal({
      requestedAmount: 5000,
      navPerUnit: 1.25,
      availableUnits: 4000,
    }),
    { unitsRedeemed: 4000, grossAmount: 5000 },
  );
});

test("tolerates float dust at the exact balance boundary", () => {
  const result = redeemUnitsForWithdrawal({
    requestedAmount: 3333.33,
    navPerUnit: 3,
    availableUnits: 1111.11,
  });
  assert.equal(result.unitsRedeemed, 1111.11);
});

test("keeps late investors from receiving prior-period gains", () => {
  const founderUnits = issueUnitsForDeposit({ amount: 10000, navPerUnit: 1 });
  const navAfterGain = calculateNavPerUnit({ netAssetValue: 12000, totalUnits: founderUnits });
  const lateUnits = issueUnitsForDeposit({ amount: 6000, navPerUnit: navAfterGain });
  const totalUnits = founderUnits + lateUnits;

  assert.equal(navAfterGain, 1.2);
  assert.equal(lateUnits, 5000);
  assert.equal(roundMoney(founderUnits * navAfterGain), 12000);
  assert.equal(roundMoney(lateUnits * navAfterGain), 6000);
  assert.equal(calculateOwnershipPercent({ investorUnits: lateUnits, totalUnits }), 33.333333);
});

test("supports negative P&L weeks through lower NAV per unit", () => {
  assert.equal(calculateNavPerUnit({ netAssetValue: 8500, totalUnits: 10000 }), 0.85);
});

test("rounds money and units deterministically", () => {
  assert.equal(roundMoney(10.005), 10.01);
  assert.equal(roundUnits(1.23456789), 1.234568);
});

test("fixed savings interest accrues outside equity NAV", () => {
  const interest = accrueDailyCompoundInterest({
    principal: 10000,
    annualRatePercent: 3.65,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  });

  assert.equal(interest, 30.04);
});

test("brokerage value allocation excludes fixed savings funded profit from equity NAV", () => {
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 60000,
    fixedSavingsNetInvested: 40000,
    brokerageNetInvested: 0,
    totalValue: 110000,
  });

  assert.equal(allocation.totalNetInvested, 100000);
  assert.equal(allocation.profitLoss, 10000);
  assert.equal(allocation.equityRatio, 60);
  assert.equal(allocation.fixedSavingsRatio, 40);
  assert.equal(allocation.equityNavValue, 66000);
  assert.equal(allocation.brokerageProfitLoss, 4000);
});

test("non-equity investment P&L includes fixed savings and brokerage funded shares", () => {
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 60000,
    fixedSavingsNetInvested: 30000,
    brokerageNetInvested: 10000,
    totalValue: 110000,
  });

  assert.equal(allocation.equityProfitLoss, 6000);
  assert.equal(allocation.fixedSavingsProfitLoss, 3000);
  assert.equal(allocation.brokerageProfitLoss, 4000);
});

// Withdrawing principal out of a profitable platform drives net invested to
// zero or below. The profit split then has no basis in net terms, and zeroing
// the ratios would drop the platform's value out of NAV entirely.

test("keeps platform value in NAV after all principal is withdrawn", () => {
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 0,
    fixedSavingsNetInvested: 0,
    brokerageNetInvested: 0,
    equityContributed: 10000,
    fixedSavingsContributed: 0,
    brokerageContributed: 0,
    totalValue: 10000,
  });

  assert.equal(allocation.profitLoss, 10000);
  assert.equal(allocation.equityRatio, 100);
  assert.equal(allocation.equityNavValue, 10000);
});

test("handles negative net invested when withdrawals exceed contributions", () => {
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: -10000,
    fixedSavingsNetInvested: 0,
    brokerageNetInvested: 0,
    equityContributed: 10000,
    fixedSavingsContributed: 0,
    brokerageContributed: 0,
    totalValue: 0,
  });

  assert.equal(allocation.profitLoss, 10000);
  assert.equal(allocation.equityNavValue, 0);
});

test("preserves the funding split from contributions when principal is fully withdrawn", () => {
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 0,
    fixedSavingsNetInvested: 0,
    brokerageNetInvested: 0,
    equityContributed: 6000,
    fixedSavingsContributed: 4000,
    brokerageContributed: 0,
    totalValue: 10000,
  });

  // Equity funded 60% of the platform, so it keeps 60% of the remaining gain
  // rather than absorbing the fixed-savings share.
  assert.equal(allocation.equityRatio, 60);
  assert.equal(allocation.fixedSavingsRatio, 40);
  assert.equal(allocation.equityNavValue, 6000);
  assert.equal(allocation.fixedSavingsProfitLoss, 4000);
});

test("net invested remains the basis while it is positive", () => {
  // Contributions differ from net invested after a partial withdrawal; the
  // ongoing split must still follow capital actually left in the platform.
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 5000,
    fixedSavingsNetInvested: 5000,
    brokerageNetInvested: 0,
    equityContributed: 20000,
    fixedSavingsContributed: 5000,
    brokerageContributed: 0,
    totalValue: 12000,
  });

  assert.equal(allocation.equityRatio, 50);
  assert.equal(allocation.fixedSavingsRatio, 50);
  assert.equal(allocation.equityNavValue, 6000);
});

test("falls back to equity when neither net invested nor contributions are known", () => {
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 0,
    fixedSavingsNetInvested: 0,
    brokerageNetInvested: 0,
    totalValue: 7500,
  });

  assert.equal(allocation.equityRatio, 100);
  assert.equal(allocation.equityNavValue, 7500);
});

test("a loss with partial cash out keeps net invested positive and reports the loss", () => {
  // 10k invested, value fell to 5k, then the remaining 5k was withdrawn.
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 5000,
    fixedSavingsNetInvested: 0,
    brokerageNetInvested: 0,
    equityContributed: 10000,
    fixedSavingsContributed: 0,
    brokerageContributed: 0,
    totalValue: 0,
  });

  assert.equal(allocation.profitLoss, -5000);
  assert.equal(allocation.equityNavValue, 0);
});

test("fixed savings withdrawal is allocated across active accounts", () => {
  assert.deepEqual(
    allocateFixedSavingsWithdrawal({
      accounts: [
        { id: "first", balance: 5000 },
        { id: "second", balance: 4049.73 },
      ],
      amount: 8000,
    }),
    [
      { id: "first", amount: 5000 },
      { id: "second", amount: 3000 },
    ],
  );
});

test("fixed savings withdrawal consumes accrued interest before principal", () => {
  assert.deepEqual(
    allocateFixedSavingsWithdrawal({
      accounts: [{ id: "principal", balance: 9000 }],
      interestBalance: 49.73,
      amount: 8000,
    }),
    {
      principal: [{ id: "principal", amount: 7950.27 }],
      interest: 49.73,
    },
  );
});

test("fixed savings withdrawal can be interest only without a separate target", () => {
  assert.deepEqual(
    allocateFixedSavingsWithdrawal({
      accounts: [{ id: "principal", balance: 9000 }],
      interestBalance: 49.73,
      amount: 49.73,
    }),
    {
      principal: [],
      interest: 49.73,
    },
  );
});

test("profit shares are taken from exact fractions, not rounded percentages", () => {
  // A basis that does not divide cleanly: rounding the ratio to 2dp before
  // applying it used to lose money against the total on large balances.
  const allocation = calculateBrokerageFundingAllocation({
    equityNetInvested: 333333,
    fixedSavingsNetInvested: 333333,
    brokerageNetInvested: 333334,
    equityContributed: 333333,
    fixedSavingsContributed: 333333,
    brokerageContributed: 333334,
    totalValue: 1500000,
  });

  // Equity's share plus everything else must still be the whole profit.
  assert.equal(
    roundMoney(allocation.equityProfitLoss + allocation.brokerageProfitLoss),
    allocation.profitLoss,
  );
  // And the platform's parts must still sum to its value.
  assert.equal(
    roundMoney(
      allocation.equityNavValue
        + allocation.fixedSavingsNetInvested
        + allocation.brokerageNetInvested
        + allocation.brokerageProfitLoss,
    ),
    1500000,
  );
});

test("sweeping less than principal realises nothing", () => {
  // Capital comes back before profit does, so a partial sweep is return of
  // capital however well the account is marked.
  assert.equal(realisedNonEquityProfit({ flows: [100000, -60000] }), 0);
});

test("sweeping past principal realises the excess", () => {
  assert.equal(realisedNonEquityProfit({ flows: [100000, -120000] }), 20000);
});

test("topping the account back up does not un-realise a past gain", () => {
  // Net invested swings positive again, but the money was genuinely taken off
  // the table. Measuring today's net rather than its low point would silently
  // erase 20,000 of realised profit.
  assert.equal(
    realisedNonEquityProfit({ flows: [100000, -120000, 50000] }),
    20000,
  );
});

test("a shut account realises whatever capital never came back as a loss", () => {
  assert.equal(
    realisedNonEquityProfit({ flows: [100000, -60000], closed: true }),
    -40000,
  );
});

test("a shut account still realises profit taken out above capital", () => {
  assert.equal(
    realisedNonEquityProfit({ flows: [100000, -120000], closed: true }),
    20000,
  );
});

test("an open account at a loss realises nothing until it is shut", () => {
  assert.equal(realisedNonEquityProfit({ flows: [100000] }), 0);
});

test("realised and unrealised always add back to total non-equity P&L", () => {
  // The crash case: 20,000 swept out, then topped up and lost. Overall a
  // 10,000 loss, of which 20,000 was banked and 30,000 went down with the mark.
  const split = splitNonEquityProfit({
    platforms: [{ flows: [100000, -120000, 50000] }],
    totalProfitLoss: -10000,
  });
  assert.equal(split.realised, 20000);
  assert.equal(split.unrealised, -30000);
  assert.equal(roundMoney(split.realised + split.unrealised), split.total);
});

test("realised profit sums across platforms", () => {
  const split = splitNonEquityProfit({
    platforms: [
      { flows: [50000, -70000] },
      { flows: [30000, -10000] },
      { flows: [20000, -5000], closed: true },
    ],
    totalProfitLoss: 25000,
  });
  // 20,000 swept past capital, nothing from the second, and the shut account
  // never returned 15,000 of what it was given.
  assert.equal(split.realised, 5000);
  assert.equal(split.unrealised, 20000);
});
