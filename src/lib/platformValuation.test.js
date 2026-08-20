const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MATERIAL_WEIGHT_PERCENT,
  STALE_AFTER_DAYS,
  blockingValuations,
  resolvePlatformValue,
  selectValuationAsOf,
} = require("./platformValuation");

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

test("a platform carries the last value forward and reports its age", () => {
  const resolved = resolvePlatformValue({
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
    netInvested: 100_000,
    valuations: [{ asOfDate: "2026-01-01", totalValue: 104_800 }],
    asOfDate: "2026-03-01",
  });
  assert.equal(resolved.ageDays, 59);
  assert.equal(resolved.isStale, true);
});

test("a same-day valuation is RECORDED, not carried forward", () => {
  const resolved = resolvePlatformValue({
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
    netInvested: 50_000,
    valuations: [],
    asOfDate: "2026-02-28",
  });
  assert.equal(resolved.totalValue, 50_000);
  assert.equal(resolved.source, "NET_INVESTED_FALLBACK");
  assert.equal(resolved.isStale, true);
  assert.equal(resolved.valuationDate, null);
});

test("a value mark of zero is honoured, not treated as missing", () => {
  // Closing a platform means marking it worth nothing. Falling back to net
  // invested here would keep a dead platform alive in gross assets.
  const resolved = resolvePlatformValue({
    netInvested: 10_000,
    valuations: [{ asOfDate: "2026-02-28", totalValue: 0 }],
    asOfDate: "2026-02-28",
  });
  assert.equal(resolved.totalValue, 0);
  assert.equal(resolved.source, "RECORDED");
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
