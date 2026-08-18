// Kept dependency-free to match the other plain-JS accounting modules, which
// are loaded directly by the node test runner.
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const TRACKING_MODES = ["CASHFLOW", "POSITION"];

// A platform valuation older than this is flagged in the NAV review screen.
const STALE_AFTER_DAYS = 30;

// When a NAV lock settles capital movements, a platform that is both stale and
// material misprices units. Both thresholds must be crossed to block a lock.
const MATERIAL_WEIGHT_PERCENT = 10;

function isTrackingMode(value) {
  return TRACKING_MODES.includes(value);
}

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
 * Value a POSITION platform from its holdings plus uninvested cash. Returns
 * null when any held asset has no usable price, so the caller can fall back to
 * a recorded valuation rather than silently reporting a too-low value.
 */
function valueFromHoldings({ holdings, cashBalance }) {
  let total = roundMoney(Number(cashBalance) || 0);
  const missingPrices = [];

  for (const holding of holdings) {
    const quantity = Number(holding.quantity) || 0;
    if (Math.abs(quantity) < 1e-8) continue;
    const price = Number(holding.latestPrice);
    const fxRate = Number(holding.fxRateToBase ?? 1) || 1;
    if (!Number.isFinite(price) || price <= 0) {
      missingPrices.push(holding.symbol);
      continue;
    }
    total = roundMoney(total + quantity * price * fxRate);
  }

  if (missingPrices.length > 0) return { totalValue: null, missingPrices };
  return { totalValue: total, missingPrices: [] };
}

/**
 * Resolve one platform's value for a NAV date. POSITION platforms compute from
 * holdings and fall back to a recorded valuation; CASHFLOW platforms always use
 * the recorded valuation, carried forward when not refreshed.
 */
function resolvePlatformValue({
  trackingMode,
  netInvested,
  valuations = [],
  holdings = null,
  cashBalance = 0,
  asOfDate,
}) {
  const invested = roundMoney(Number(netInvested) || 0);

  if (trackingMode === "POSITION" && holdings) {
    const computed = valueFromHoldings({ holdings, cashBalance });
    if (computed.totalValue !== null) {
      return {
        totalValue: computed.totalValue,
        source: "COMPUTED",
        valuationDate: asOfDate,
        ageDays: 0,
        isStale: false,
        missingPrices: [],
      };
    }
    const fallback = selectValuationAsOf(valuations, asOfDate);
    if (fallback) {
      const ageDays = daysBetween(fallback.asOfDate, asOfDate);
      return {
        totalValue: roundMoney(fallback.totalValue),
        source: "RECORDED_FALLBACK",
        valuationDate: fallback.asOfDate,
        ageDays,
        isStale: ageDays > STALE_AFTER_DAYS,
        missingPrices: computed.missingPrices,
      };
    }
    return {
      totalValue: invested,
      source: "NET_INVESTED_FALLBACK",
      valuationDate: null,
      ageDays: null,
      isStale: true,
      missingPrices: computed.missingPrices,
    };
  }

  const recorded = selectValuationAsOf(valuations, asOfDate);
  if (!recorded) {
    // No mark ever taken: assume flat rather than inventing a gain.
    return {
      totalValue: invested,
      source: "NET_INVESTED_FALLBACK",
      valuationDate: null,
      ageDays: null,
      isStale: true,
      missingPrices: [],
    };
  }

  const ageDays = daysBetween(recorded.asOfDate, asOfDate);
  return {
    totalValue: roundMoney(recorded.totalValue),
    source: ageDays === 0 ? "RECORDED" : "CARRIED_FORWARD",
    valuationDate: recorded.asOfDate,
    ageDays,
    isStale: ageDays > STALE_AFTER_DAYS,
    missingPrices: [],
  };
}

/**
 * Which platforms must be refreshed before a NAV lock may settle capital
 * movements. Stale alone is tolerated; stale AND material is not, because that
 * combination transfers value between investors at the wrong unit price.
 */
function blockingValuations(resolved) {
  const grossValue = resolved.reduce((sum, item) => sum + (Number(item.totalValue) || 0), 0);
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
  TRACKING_MODES,
  blockingValuations,
  daysBetween,
  isTrackingMode,
  resolvePlatformValue,
  selectValuationAsOf,
  valueFromHoldings,
};
