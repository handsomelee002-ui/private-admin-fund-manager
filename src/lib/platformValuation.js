// Kept dependency-free to match the other plain-JS accounting modules, which
// are loaded directly by the node test runner.
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// A platform valuation older than this is flagged in the NAV review screen.
const STALE_AFTER_DAYS = 30;

// When a NAV lock settles capital movements, a platform that is both stale and
// material misprices units. Both thresholds must be crossed to block a lock.
const MATERIAL_WEIGHT_PERCENT = 10;

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date.");
  }
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Latest valuation recorded on or before asOfDate. Valuations after the
 * valuation date must never leak into a historical NAV.
 */
function selectValuationAsOf(valuations, asOfDate) {
  const eligible = valuations
    .filter((valuation) => valuation.asOfDate <= asOfDate)
    .sort((a, b) => (a.asOfDate < b.asOfDate ? 1 : a.asOfDate > b.asOfDate ? -1 : 0));
  return eligible[0] ?? null;
}

/**
 * Resolve one platform's value for a NAV date from its recorded value marks,
 * carried forward when the platform was not refreshed on the NAV date itself.
 */
function resolvePlatformValue({ netInvested, valuations = [], asOfDate, closed = false }) {
  const invested = roundMoney(Number(netInvested) || 0);
  const recorded = selectValuationAsOf(valuations, asOfDate);

  // A shut account is worth nothing, and no amount of waiting will refresh it.
  // Reporting it stale would block NAV locks forever over a platform that is
  // never going to be valued again; carrying it at cost, which is what the
  // fallback below does, would keep dead money in gross assets.
  if (closed) {
    return {
      totalValue: 0,
      source: "CLOSED",
      valuationDate: recorded ? recorded.asOfDate : null,
      ageDays: null,
      isStale: false,
    };
  }

  if (!recorded) {
    // No mark ever taken: assume flat rather than inventing a gain.
    return {
      totalValue: invested,
      source: "NET_INVESTED_FALLBACK",
      valuationDate: null,
      ageDays: null,
      isStale: true,
    };
  }

  const ageDays = daysBetween(recorded.asOfDate, asOfDate);
  return {
    totalValue: roundMoney(recorded.totalValue),
    source: ageDays === 0 ? "RECORDED" : "CARRIED_FORWARD",
    valuationDate: recorded.asOfDate,
    ageDays,
    isStale: ageDays > STALE_AFTER_DAYS,
  };
}

/**
 * Which platforms must be refreshed before a NAV lock may settle capital
 * movements. Stale alone is tolerated; stale AND material is not, because that
 * combination transfers value between investors at the wrong unit price.
 */
function blockingValuations(resolved, fundCash = 0) {
  // Cash the fund holds is part of what a platform's weight is measured
  // against. Leaving it out overstated every weight and blocked settlement
  // more often than the documented 10% rule.
  const platformValue = resolved.reduce((sum, item) => sum + (Number(item.totalValue) || 0), 0);
  const grossValue = platformValue + Math.max(0, Number(fundCash) || 0);
  if (grossValue <= 0) return [];

  return resolved
    .map((item) => ({
      ...item,
      weightPercent: roundMoney(((Number(item.totalValue) || 0) / grossValue) * 100),
    }))
    .filter((item) => item.isStale && item.weightPercent >= MATERIAL_WEIGHT_PERCENT);
}

module.exports = {
  MATERIAL_WEIGHT_PERCENT,
  STALE_AFTER_DAYS,
  blockingValuations,
  daysBetween,
  resolvePlatformValue,
  selectValuationAsOf,
};
