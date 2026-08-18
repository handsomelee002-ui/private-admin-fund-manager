const assert = require("node:assert/strict");
const test = require("node:test");

const {
  accrueDailyCompoundInterest,
  calculateBrokerageFundingAllocation,
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
