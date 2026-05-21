import test from "node:test";
import assert from "node:assert/strict";
import formatting from "./formatting.js";

const { formatMoney, formatUnits } = formatting;

test("formats money with a deterministic en-US locale", () => {
  assert.equal(formatMoney(11000), "RM 11,000.00");
  assert.equal(formatMoney("0"), "RM 0.00");
});

test("formats unit balances without runtime locale drift", () => {
  assert.equal(formatUnits(1234567.1234567), "1,234,567.123457");
  assert.equal(formatUnits(0), "0");
});
