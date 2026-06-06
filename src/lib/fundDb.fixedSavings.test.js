const assert = require("node:assert/strict");
const test = require("node:test");
const { installTsRuntime } = require("../../scripts/test-runtime.cjs");

installTsRuntime({ mockAuth: true });

const { calculateFixedSavingsLiability } = require("./fundDb.ts");

test("fixed savings uses nominal daily compounding with promotion periods", () => {
  const rows = [
    { investor_id: "lee", date: "2025-04-01", type: "Deposit", amount: 1050, audit_status: "active" },
    { investor_id: "lee", date: "2025-04-18", type: "Deposit", amount: 1050, audit_status: "active" },
    { investor_id: "lee", date: "2025-05-02", type: "Deposit", amount: 500, audit_status: "active" },
    { investor_id: "lee", date: "2025-05-13", type: "Deposit", amount: 400, audit_status: "active" },
    { investor_id: "lee", date: "2025-05-22", type: "Deposit", amount: 5000, audit_status: "active" },
    { investor_id: "lee", date: "2025-06-09", type: "Withdrawal", amount: 2000, audit_status: "active" },
  ];
  const rates = {
    baseRates: [{ effective_date: "1970-01-01", annual_rate_percent: 4 }],
    promotions: [{ name: "Launch", start_date: "2025-05-22", end_date: "2025-08-22", annual_rate_percent: 5, status: "active" }],
  };

  const summary = calculateFixedSavingsLiability(rows, "2025-06-09", rates);

  assert.equal(summary.totalLiability, 6031.08);
  assert.equal(summary.byInvestor.get("lee").totalLiability, 6031.08);
});

test("fixed savings promotion cap applies promo rate only up to the capped balance", () => {
  const summary = calculateFixedSavingsLiability(
    [{ investor_id: "lee", date: "2025-01-01", type: "Deposit", amount: 15000, audit_status: "active" }],
    "2025-01-02",
    {
      baseRates: [{ effective_date: "1970-01-01", annual_rate_percent: 4 }],
      promotions: [{
        name: "Capped",
        start_date: "2025-01-01",
        end_date: "2025-01-31",
        annual_rate_percent: 5,
        balance_cap: 10000,
        status: "active",
      }],
    },
  );

  assert.equal(summary.totalLiability, 15001.92);
});
