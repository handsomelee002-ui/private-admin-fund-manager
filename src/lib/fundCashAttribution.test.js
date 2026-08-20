const assert = require("node:assert/strict");
const test = require("node:test");

const { calculateEquityFundCash } = require("./accounting.js");

/**
 * The invariant every case below checks:
 *
 *   equity + fixedSavings + brokerage === platformValue + bankCash
 *
 * If that ever stops holding, some pool's money has been created or destroyed.
 */
function assertPoolsReconcile(result, { platformValue }) {
  // `result.equity` is equity's share of *cash* only, so its full claim adds
  // back the platform value that is not owned by the other two pools.
  const equityClaim = (platformValue - result.nonEquityValueInPlatforms) + result.equity;
  const allClaims = equityClaim + result.fixedSavingsLiability + result.brokerageClaim;
  const allAssets = platformValue + result.bankBalance;
  assert.equal(Math.round(allClaims * 100) / 100, Math.round(allAssets * 100) / 100);
}

const empty = {
  bankBalance: 0,
  nonEquityValueInPlatforms: 0,
  fixedSavingsLiability: 0,
  nonEquityPlatformProfitLoss: 0,
  performanceFees: 0,
  cumulativeFixedSavingsInterest: 0,
  cumulativeFixedSavingsBonuses: 0,
  cumulativeEquityBonuses: 0,
};

test("savers' undeployed cash does not belong to equity", () => {
  // RM10,000 equity + RM5,000 fixed savings, nothing deployed.
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 15000,
    fixedSavingsLiability: 5000,
  });
  assert.equal(result.equity, 10000);
  assertPoolsReconcile(result, { platformValue: 0 });
});

test("accrued savings interest is borne by the brokerage pot, not by equity", () => {
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 15000,
    fixedSavingsLiability: 5050,
    cumulativeFixedSavingsInterest: 50,
  });
  assert.equal(result.equity, 10000);
  assert.equal(result.brokerageClaim, -50);
});

test("paying savings interest in cash leaves equity untouched", () => {
  // Same book as above, but the RM50 has now been paid out of the bank.
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 14950,
    fixedSavingsLiability: 5000,
    cumulativeFixedSavingsInterest: 50,
  });
  assert.equal(result.equity, 10000);
});

test("fixed-savings capital deployed to a platform is not deducted from cash twice", () => {
  // RM3,000 of savers' money moved into a platform: bank down, platform up.
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 12000,
    nonEquityValueInPlatforms: 3000,
    fixedSavingsLiability: 5000,
  });
  assert.equal(result.equity, 10000);
  assertPoolsReconcile(result, { platformValue: 3000 });
});

test("non-equity platform profit accrues to the pot, not to equity", () => {
  // Platform holds 3,000 of savers' principal and has gained 818.18 on it.
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 12000,
    nonEquityValueInPlatforms: 3818.18,
    fixedSavingsLiability: 5000,
    nonEquityPlatformProfitLoss: 818.18,
  });
  assert.equal(result.equity, 10000);
  assert.equal(result.brokerageClaim, 818.18);
});

test("a withheld performance fee moves value to the pot, not to equity", () => {
  // The fee stayed in the bank instead of going to the investor.
  const before = calculateEquityFundCash({ ...empty, bankBalance: 10000 });
  const after = calculateEquityFundCash({
    ...empty,
    bankBalance: 10100,
    performanceFees: 100,
  });
  assert.equal(after.equity, before.equity);
  assert.equal(after.brokerageClaim, 100);
});

test("an equity bonus is funded by the pot, so equity's cash rises by the bonus", () => {
  const before = calculateEquityFundCash({ ...empty, bankBalance: 10000 });
  const after = calculateEquityFundCash({
    ...empty,
    bankBalance: 10000,
    cumulativeEquityBonuses: 1000,
  });
  // Equity gains exactly what the bonus units are worth, so NAV per unit is
  // unchanged for everyone else rather than diluted.
  assert.equal(after.equity - before.equity, 1000);
  assert.equal(after.brokerageClaim, -1000);
});

test("a fixed-savings bonus is funded by the pot and nets to zero for equity", () => {
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 10000,
    fixedSavingsLiability: 500,
    cumulativeFixedSavingsBonuses: 500,
  });
  assert.equal(result.equity, 10000);
  assert.equal(result.brokerageClaim, -500);
});

test("equity absorbs a shortfall rather than hiding it", () => {
  // The bank holds less than the savers are owed. Equity is the residual owner,
  // so the gap shows up there instead of being clamped away.
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 1000,
    fixedSavingsLiability: 5000,
  });
  assert.equal(result.equity, -4000);
});

test("the full worked scenario reconciles across every pool", () => {
  // 10,000 equity + 5,000 savings; equity deployed 8,000 and savings 3,000;
  // the platform is now worth 14,000 (a 3,000 gain, 818.18 of it non-equity).
  const result = calculateEquityFundCash({
    ...empty,
    bankBalance: 4000,
    nonEquityValueInPlatforms: 3818.18,
    fixedSavingsLiability: 5050,
    nonEquityPlatformProfitLoss: 818.18,
    cumulativeFixedSavingsInterest: 50,
  });
  assert.equal(result.equity, 2000);

  const equityPlatformValue = 14000 - 3818.18;
  const equityClaim = equityPlatformValue + result.equity;
  assert.equal(Math.round(equityClaim * 100) / 100, 12181.82);
  assert.equal(
    Math.round((equityClaim + result.fixedSavingsLiability + result.brokerageClaim) * 100) / 100,
    18000,
  );
});
