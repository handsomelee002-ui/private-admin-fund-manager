const MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const UNIT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SIGNED_PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

function formatMoney(value) {
  return `RM ${MONEY_FORMATTER.format(Number(value || 0))}`;
}

function formatUnits(value) {
  return UNIT_FORMATTER.format(Number(value || 0));
}

function formatPercent(value, options = {}) {
  if (value === null || value === undefined) return "-";
  const formatter = options.signed ? SIGNED_PERCENT_FORMATTER : PERCENT_FORMATTER;
  return `${formatter.format(Number(value || 0))}%`;
}

module.exports = {
  formatMoney,
  formatPercent,
  formatUnits,
};
