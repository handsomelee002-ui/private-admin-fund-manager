const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MATERIAL_WEIGHT_PERCENT,
  STALE_AFTER_DAYS,
  blockingValuations,
  isTrackingMode,
  resolvePlatformValue,
  selectValuationAsOf,
  valueFromHoldings,
} = require("./platformValuation");

test("isTrackingMode accepts only the two supported modes", () => {
  assert.equal(isTrackingMode("CASHFLOW"), true);
  assert.equal(isTrackingMode("POSITION"), true);
  assert.equal(isTrackingMode("cashflow"), false);
  assert.equal(isTrackingMode("OTHER"), false);
});

test("selectValuationAsOf never returns a valuation from the future", () => {
  const valuations = [
    { asOfDate: "2026-01-31", totalValue: 100 },
    { asOfDate: "2026-02-28", totalValue: 200 },
    { asOfDate: "2026-03-31", totalValue: 300 },
  ];
  assert.equal(selectValuationAsOf(valuations, "2026-02-28").totalValue, 200);
  assert.equal(selectValuationAsOf(valuations, "2026-03-01").totalValue, 200);
  assert.equal(selectValuationAsOf(valuations, "2026-01-01"), null);
});

test("valueFromHoldings sums quantity times price plus cash", () => {
  const result = valueFromHoldings({
    holdings: [
      { symbol: "AAPL", quantity: 200, latestPrice: 520, fxRateToBase: 1 },
      { symbol: "MSFT", quantity: 100, latestPrice: 415, fxRateToBase: 1 },
    ],
    cashBalance: 10_750,
  });
  assert.equal(result.totalValue, 156_250);
  assert.deepEqual(result.missingPrices, []);
});

test("valueFromHoldings applies the FX rate to base currency", () => {
  const result = valueFromHoldings({
    holdings: [{ symbol: "AAPL", quantity: 10, latestPrice: 100, fxRateToBase: 4.5 }],
    cashBalance: 0,
  });
  assert.equal(result.totalValue, 4500);
});

test("valueFromHoldings reports missing prices instead of undervaluing", () => {
  const result = valueFromHoldings({
    holdings: [
      { symbol: "AAPL", quantity: 200, latestPrice: 520, fxRateToBase: 1 },
      { symbol: "XYZ", quantity: 50, latestPrice: 0, fxRateToBase: 1 },
    ],
    cashBalance: 1000,
  });
  assert.equal(result.totalValue, null);
  assert.deepEqual(result.missingPrices, ["XYZ"]);
});

test("valueFromHoldings ignores fully closed positions", () => {
  const result = valueFromHoldings({
    holdings: [{ symbol: "SOLD", quantity: 0, latestPrice: 0, fxRateToBase: 1 }],
    cashBalance: 500,
  });
  assert.equal(result.totalValue, 500);
  assert.deepEqual(result.missingPrices, []);
});

test("CASHFLOW platform carries the last value forward and reports its age", () => {
  const resolved = resolvePlatformValue({
    trackingMode: "CASHFLOW",
    netInvested: 100_000,
    valuations: [{ asOfDate: "2026-01-31", totalValue: 104_800 }],
    asOfDate: "2026-02-28",
  });
  assert.equal(resolved.totalValue, 104_800);
  assert.equal(resolved.source, "CARRIED_FORWARD");
  assert.equal(resolved.ageDays, 28);
  assert.equal(resolved.isStale, false);
});

test("a valuation older than the stale threshold is flagged", () => {
  const resolved = resolvePlatformValue({
    trackingMode: "CASHFLOW",
    netInvested: 100_000,
    valuations: [{ asOfDate: "2026-01-01", totalValue: 104_800 }],
    asOfDate: "2026-03-01",
  });
  assert.equal(resolved.ageDays, 59);
  assert.equal(resolved.isStale, true);
});

test("a same-day valuation is RECORDED, not carried forward", () => {
  const resolved = resolvePlatformValue({
    trackingMode: "CASHFLOW",
    netInvested: 80_000,
    valuations: [{ asOfDate: "2026-02-28", totalValue: 92_400 }],
    asOfDate: "2026-02-28",
  });
  assert.equal(resolved.source, "RECORDED");
  assert.equal(resolved.ageDays, 0);
  assert.equal(resolved.isStale, false);
});

test("a never-valued platform falls back to net invested and is stale", () => {
  const resolved = resolvePlatformValue({
    trackingMode: "CASHFLOW",
    netInvested: 50_000,
    valuations: [],
    asOfDate: "2026-02-28",
  });
  assert.equal(resolved.totalValue, 50_000);
  assert.equal(resolved.source, "NET_INVESTED_FALLBACK");
  assert.equal(resolved.isStale, true);
  assert.equal(resolved.valuationDate, null);
});

test("POSITION platform computes from holdings and is never stale", () => {
  const resolved = resolvePlatformValue({
    trackingMode: "POSITION",
    netInvested: 150_000,
    holdings: [{ symbol: "AAPL", quantity: 200, latestPrice: 520, fxRateToBase: 1 }],
    cashBalance: 10_750,
    asOfDate: "2026-02-28",
  });
  assert.equal(resolved.totalValue, 114_750);
  assert.equal(resolved.source, "COMPUTED");
  assert.equal(resolved.isStale, false);
});

test("POSITION platform falls back to a recorded valuation when a price is missing", () => {
  const resolved = resolvePlatformValue({
    trackingMode: "POSITION",
    netInvested: 150_000,
    holdings: [{ symbol: "XYZ", quantity: 10, latestPrice: 0, fxRateToBase: 1 }],
    cashBalance: 0,
    valuations: [{ asOfDate: "2026-02-20", totalValue: 158_900 }],
    asOfDate: "2026-02-28",
  });
  assert.equal(resolved.totalValue, 158_900);
  assert.equal(resolved.source, "RECORDED_FALLBACK");
  assert.deepEqual(resolved.missingPrices, ["XYZ"]);
});

test("blockingValuations flags only platforms that are both stale and material", () => {
  const blocking = blockingValuations([
    { platformName: "Bursa", totalValue: 104_800, isStale: true },
    { platformName: "eToro", totalValue: 97_300, isStale: true },
    { platformName: "P2P", totalValue: 5_000, isStale: true },
    { platformName: "Moomoo", totalValue: 158_900, isStale: false },
  ]);
  const names = blocking.map((row) => row.platformName);
  assert.deepEqual(names, ["Bursa", "eToro"]);
});

test("blockingValuations returns nothing when every value is fresh", () => {
  const blocking = blockingValuations([
    { platformName: "Bursa", totalValue: 104_800, isStale: false },
    { platformName: "Moomoo", totalValue: 158_900, isStale: false },
  ]);
  assert.deepEqual(blocking, []);
});

test("thresholds are the documented values", () => {
  assert.equal(STALE_AFTER_DAYS, 30);
  assert.equal(MATERIAL_WEIGHT_PERCENT, 10);
});
