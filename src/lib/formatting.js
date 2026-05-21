const MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const UNIT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

function formatMoney(value) {
  return `RM ${MONEY_FORMATTER.format(Number(value || 0))}`;
}

function formatUnits(value) {
  return UNIT_FORMATTER.format(Number(value || 0));
}

module.exports = {
  formatMoney,
  formatUnits,
};
