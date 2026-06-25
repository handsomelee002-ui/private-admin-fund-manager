const assert = require("node:assert/strict");
const test = require("node:test");

const { calculateClaimSettlement } = require("./profitClaimAccounting.js");

test("final claim settlement records only the remaining unpaid net amount", () => {
  assert.deepEqual(
    calculateClaimSettlement({
      lockedAmount: 1000,
      previousSettledAmount: 400,
      brokerageFee: 20,
      requestedSettlementAmount: 1000,
    }),
    {
      cappedAmount: 580,
      finalSettledAmount: 980,
      isFullySettled: true,
      ledgerAmount: 580,
      netPayable: 980,
      status: "settled",
    },
  );
});
