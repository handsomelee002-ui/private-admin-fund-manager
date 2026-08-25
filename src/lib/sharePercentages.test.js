const assert = require("node:assert/strict");
const test = require("node:test");

const { allocateSharePercentages } = require("./accounting.js");

/** A pie chart legend that does not add to 100 reads as a bug. */
function assertSumsTo100(percentages) {
  const total = percentages.reduce((sum, percent) => sum + percent, 0);
  assert.equal(Math.round(total * 100) / 100, 100);
}

test("even splits divide exactly", () => {
  assert.deepEqual(allocateSharePercentages([25, 25, 25, 25]), [25, 25, 25, 25]);
});

test("thirds still add to exactly 100 despite rounding", () => {
  // 33.333... each. Rounding all three independently gives 99.99.
  const result = allocateSharePercentages([1, 1, 1]);
  assert.deepEqual(result, [33.33, 33.33, 33.34]);
  assertSumsTo100(result);
});

test("the residual lands on the last non-zero share, not a zero one", () => {
  const result = allocateSharePercentages([1, 1, 1, 0]);
  assert.deepEqual(result, [33.33, 33.33, 33.34, 0]);
  assertSumsTo100(result);
});

test("realistic platform values sum to 100", () => {
  const result = allocateSharePercentages([454000, 373500, 364875, 348000, 22500]);
  assertSumsTo100(result);
  // Largest platform keeps its true share rather than absorbing the residual.
  assert.equal(result[0], 29.05);
});

test("an empty book yields no shares rather than dividing by zero", () => {
  assert.deepEqual(allocateSharePercentages([]), []);
  assert.deepEqual(allocateSharePercentages([0, 0]), [0, 0]);
});

test("a single platform is the whole allocation", () => {
  assert.deepEqual(allocateSharePercentages([12345.67]), [100]);
});

test("negative values are treated as zero, not as a negative slice", () => {
  // A platform cannot own a negative share of the fund's assets.
  const result = allocateSharePercentages([100, -50, 100]);
  assert.deepEqual(result, [50, 0, 50]);
  assertSumsTo100(result);
});

test("a dominant platform does not round its small neighbours away", () => {
  const result = allocateSharePercentages([999000, 500, 500]);
  assertSumsTo100(result);
  assert.equal(result[1] > 0, true);
  assert.equal(result[2] > 0, true);
});
