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

test("fund cash counts toward the materiality denominator", () => {
  // A platform worth 10,000 against 10,000 of platform value alone is 100% of
  // the fund and blocks settlement. With 90,000 of fund cash it is 10% - still
  // material - and with 190,000 it drops below the threshold.
  const stalePlatform = {
    totalValue: 10000,
    source: "CARRIED_FORWARD",
    valuationDate: "2025-01-01",
    ageDays: 90,
    isStale: true,
  };

  assert.equal(blockingValuations([stalePlatform]).length, 1);
  assert.equal(blockingValuations([stalePlatform], 90000).length, 1);
  assert.equal(blockingValuations([stalePlatform], 190000).length, 0);
});

test("a fresh platform never blocks regardless of weight", () => {
  const fresh = {
    totalValue: 10000,
    source: "RECORDED",
    valuationDate: "2025-06-01",
    ageDays: 0,
    isStale: false,
  };
  assert.equal(blockingValuations([fresh]).length, 0);
  assert.equal(blockingValuations([fresh], 0).length, 0);
});

test("a closed platform is worth nothing, whatever it cost", () => {
  // The fallback marks an unvalued platform at cost. For a shut account that
  // keeps money in gross assets that is demonstrably gone.
  const resolved = resolvePlatformValue({
    netInvested: 40000,
    valuations: [],
    asOfDate: "2026-06-05",
    closed: true,
  });
  assert.equal(resolved.totalValue, 0);
  assert.equal(resolved.source, "CLOSED");
});

test("a closed platform is never stale, so it cannot block a NAV lock forever", () => {
  // Nobody is going to refresh a dead account's valuation, so treating it as
  // stale would wedge every future lock behind a mark that will never arrive.
  const resolved = resolvePlatformValue({
    netInvested: 40000,
    valuations: [{ asOfDate: "2025-01-01", totalValue: 0 }],
    asOfDate: "2026-06-05",
    closed: true,
  });
  assert.equal(resolved.isStale, false);
  assert.equal(resolved.totalValue, 0);
});

test("a closed platform overrides a stale non-zero mark", () => {
  const resolved = resolvePlatformValue({
    netInvested: 40000,
    valuations: [{ asOfDate: "2026-06-01", totalValue: 38000 }],
    asOfDate: "2026-06-05",
    closed: true,
  });
  assert.equal(resolved.totalValue, 0);
});

test("a platform with no mark of its own is carried at what the last locked NAV priced it", () => {
  // The review screen writes a typed value into that NAV's snapshot. Before the
  // snapshot fallback existed this platform dropped to cost and the next NAV
  // silently gave back the whole gain the previous one recognised.
  const resolved = resolvePlatformValue({
    netInvested: 192900,
    valuations: [],
    asOfDate: "2026-08-25",
    lastNavSnapshot: { weekEnding: "2026-06-25", totalValue: 300000 },
  });
  assert.equal(resolved.totalValue, 300000);
  assert.equal(resolved.source, "NAV_SNAPSHOT");
  assert.equal(resolved.valuationDate, "2026-06-25");
  assert.equal(resolved.ageDays, 61);
  assert.equal(resolved.isStale, true);
});

test("a mark of the platform's own beats the NAV snapshot", () => {
  const resolved = resolvePlatformValue({
    netInvested: 192900,
    valuations: [{ asOfDate: "2026-08-20", totalValue: 210000 }],
    asOfDate: "2026-08-25",
    lastNavSnapshot: { weekEnding: "2026-06-25", totalValue: 300000 },
  });
  assert.equal(resolved.totalValue, 210000);
  assert.equal(resolved.source, "CARRIED_FORWARD");
});

test("a NAV snapshot from after the valuation date never leaks backwards", () => {
  // Same rule as selectValuationAsOf: pricing a historical NAV with a later
  // NAV's numbers would rewrite the past.
  const resolved = resolvePlatformValue({
    netInvested: 192900,
    valuations: [],
    asOfDate: "2026-05-01",
    lastNavSnapshot: { weekEnding: "2026-06-25", totalValue: 300000 },
  });
  assert.equal(resolved.totalValue, 192900);
  assert.equal(resolved.source, "NET_INVESTED_FALLBACK");
});

test("a snapshot taken on the valuation date itself counts as recorded", () => {
  const resolved = resolvePlatformValue({
    netInvested: 192900,
    valuations: [],
    asOfDate: "2026-06-25",
    lastNavSnapshot: { weekEnding: "2026-06-25", totalValue: 300000 },
  });
  assert.equal(resolved.source, "RECORDED");
  assert.equal(resolved.isStale, false);
});

test("a closed platform is still worth nothing however the last NAV priced it", () => {
  const resolved = resolvePlatformValue({
    netInvested: 192900,
    valuations: [],
    asOfDate: "2026-08-25",
    closed: true,
    lastNavSnapshot: { weekEnding: "2026-06-25", totalValue: 300000 },
  });
  assert.equal(resolved.totalValue, 0);
  assert.equal(resolved.source, "CLOSED");
});
