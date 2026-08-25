const assert = require("node:assert/strict");
const test = require("node:test");

const { splitPoolAvailability } = require("./accounting.js");

/**
 * The invariant every case below checks:
 *
 *   equity.available + fixedSavings.available + brokerage.available === bankBalance
 *
 * Free cash is the bank balance sliced three ways. If the parts stop summing to
 * the whole, some pool is being shown money that is not in the account.
 */
function assertAvailabilityReconciles(result) {
  const total = result.equity.available + result.fixedSavings.available + result.brokerage.available;
  assert.equal(Math.round(total * 100) / 100, result.bankBalance);
}

/** Each pool's own row must also be internally consistent. */
function assertClaimsDecompose(result) {
  for (const pool of ["equity", "fixedSavings", "brokerage"]) {
    const { claim, deployed, available } = result[pool];
    assert.equal(
      Math.round((deployed + available) * 100) / 100,
      Math.round(claim * 100) / 100,
      `${pool}: deployed + available should equal claim`,
    );
  }
}

const empty = {
  bankBalance: 0,
  equityValueInPlatforms: 0,
  fixedSavingsLiability: 0,
  fixedSavingsPrincipalInPlatforms: 0,
  brokerageBalance: 0,
  brokerageDeployedInPlatforms: 0,
};

test("with nothing deployed, every pool's available cash is its whole claim", () => {
  const result = splitPoolAvailability({
    ...empty,
    bankBalance: 15000,
    fixedSavingsLiability: 5000,
  });
  assert.equal(result.equity.available, 10000);
  assert.equal(result.fixedSavings.available, 5000);
  assert.equal(result.brokerage.available, 0);
  assertAvailabilityReconciles(result);
  assertClaimsDecompose(result);
});

test("deploying equity capital moves it out of available cash, not out of the claim", () => {
  // RM10,000 equity, RM8,000 of it now in a platform still worth 8,000.
  const result = splitPoolAvailability({
    ...empty,
    bankBalance: 2000,
    equityValueInPlatforms: 8000,
  });
  assert.equal(result.equity.available, 2000);
  assert.equal(result.equity.deployed, 8000);
  assert.equal(result.equity.claim, 10000);
  assertAvailabilityReconciles(result);
});

test("savers' deployed principal reduces their available cash", () => {
  const result = splitPoolAvailability({
    ...empty,
    bankBalance: 12000,
    fixedSavingsLiability: 5000,
    fixedSavingsPrincipalInPlatforms: 3000,
  });
  assert.equal(result.fixedSavings.available, 2000);
  assert.equal(result.fixedSavings.deployed, 3000);
  assert.equal(result.equity.available, 10000);
  assertAvailabilityReconciles(result);
  assertClaimsDecompose(result);
});

test("profit on savers' principal is charged to the pot, not to savers", () => {
  // Savers put in 3,000; the platform is now worth 3,818.18. Their claim is
  // contractual, so the 818.18 gain belongs to the pot - held as platform value,
  // not as free cash.
  const result = splitPoolAvailability({
    ...empty,
    bankBalance: 12000,
    fixedSavingsLiability: 5000,
    fixedSavingsPrincipalInPlatforms: 3000,
    brokerageBalance: 818.18,
    brokerageDeployedInPlatforms: 818.18,
  });
  assert.equal(result.fixedSavings.deployed, 3000);
  assert.equal(result.fixedSavings.available, 2000);
  assert.equal(result.brokerage.available, 0);
  assert.equal(result.equity.available, 10000);
  assertAvailabilityReconciles(result);
  assertClaimsDecompose(result);
});

test("a withheld performance fee is free cash in the pot", () => {
  const result = splitPoolAvailability({
    ...empty,
    bankBalance: 10100,
    brokerageBalance: 100,
  });
  assert.equal(result.brokerage.available, 100);
  assert.equal(result.brokerage.deployed, 0);
  assert.equal(result.equity.available, 10000);
  assertAvailabilityReconciles(result);
});

test("accrued savings interest leaves the pot with negative available cash", () => {
  // The pot owes RM50 of interest it has not paid yet. Showing that as zero
  // would invite deploying money the pot does not have.
  const result = splitPoolAvailability({
    ...empty,
    bankBalance: 15000,
    fixedSavingsLiability: 5050,
    brokerageBalance: -50,
  });
  assert.equal(result.brokerage.available, -50);
  assert.equal(result.equity.available, 10000);
  assertAvailabilityReconciles(result);
});

test("cash withdrawn from the pot leaves both the pot and the bank smaller", () => {
  // The pot held 1,000 of fees and 400 has been paid out to the operator. Both
  // legs move together, so equity's residual share is untouched.
  const before = splitPoolAvailability({ ...empty, bankBalance: 11000, brokerageBalance: 1000 });
  const after = splitPoolAvailability({ ...empty, bankBalance: 10600, brokerageBalance: 600 });

  assert.equal(before.brokerage.available, 1000);
  assert.equal(after.brokerage.available, 600);
  assert.equal(after.equity.available, before.equity.available);
  assertAvailabilityReconciles(before);
  assertAvailabilityReconciles(after);
});

test("withdrawing against only one leg would silently move money to equity", () => {
  // Guards the reason recordBrokerageWithdrawal writes both legs: reducing the
  // pot without reducing the bank hands the difference to equity.
  const bothLegs = splitPoolAvailability({ ...empty, bankBalance: 10600, brokerageBalance: 600 });
  const potLegOnly = splitPoolAvailability({ ...empty, bankBalance: 11000, brokerageBalance: 600 });
  assert.equal(potLegOnly.equity.available - bothLegs.equity.available, 400);
});

test("a shortfall against savers shows as negative equity cash, not a clamped zero", () => {
  const result = splitPoolAvailability({
    ...empty,
    bankBalance: 1000,
    fixedSavingsLiability: 5000,
  });
  assert.equal(result.equity.available, -4000);
  assert.equal(result.fixedSavings.available, 5000);
  assertAvailabilityReconciles(result);
});

test("the full worked scenario reconciles across every pool", () => {
  // 10,000 equity + 5,000 savings. Equity deployed 8,000 and savings 3,000; the
  // platform is now worth 14,000 - a 3,000 gain, 818.18 of it non-equity. RM50
  // of savings interest has accrued, so the pot nets 768.18.
  const result = splitPoolAvailability({
    bankBalance: 4000,
    equityValueInPlatforms: 14000 - 3818.18,
    fixedSavingsLiability: 5050,
    fixedSavingsPrincipalInPlatforms: 3000,
    brokerageBalance: 768.18,
    brokerageDeployedInPlatforms: 818.18,
  });

  assert.equal(result.equity.available, 2000);
  assert.equal(result.equity.claim, 12181.82);
  assert.equal(result.fixedSavings.available, 2050);
  assert.equal(result.brokerage.claim, 768.18);
  assert.equal(result.brokerage.deployed, 818.18);
  assert.equal(result.brokerage.available, -50);

  assertAvailabilityReconciles(result);
  assertClaimsDecompose(result);
});
