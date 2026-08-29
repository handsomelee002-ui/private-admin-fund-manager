import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Every guarded, exported function that a read-only viewer is allowed to reach.
// Anything guarded and NOT in this set must require an administrator, so a new
// mutation can never be shipped behind `requireSession` by accident.
const VIEWER_READABLE = new Set([
  // src/actions
  "getAdminAuditLogs", "getAdminAuditLogDetails",
  "getInvestors",
  "ensureClaimsTable", "getAllClaims", "getClaimsByInvestor",
  "getBrokerageFeeRate", "getAllBonusPayments", "getBonusByInvestor",
  "getPlatforms", "getPlatformCapitalAllocation", "getPlatform", "getPlatformAccounts",
  "getPlatformAssets", "getPlatformTransactions", "getPlatformNavSnapshots", "getPlatformPerformance",
  "getNavPreviewAction",
  // internal schema bootstrappers (run on page load, idempotent)
  "ensureSettingsTablesUncached", "ensureTradingSchemaUncached",
  // src/lib/fundDb
  "getNavWeeks", "getBrokerageWithdrawals", "getPlatformValuations", "getFundCashAvailability",
  "getCashMovements", "getFixedSavingsLedger", "getInvestorsWithBalances",
  "getFundSummaryMetrics", "getDashboardSummary",
]);

const FILES = [
  "src/actions/adminLogs.ts", "src/actions/backups.ts", "src/actions/development.ts",
  "src/actions/fixedSavingsRates.ts", "src/actions/fund.ts", "src/actions/investors.ts",
  "src/actions/profitClaims.ts", "src/actions/settings.ts", "src/actions/trading.ts",
  "src/lib/fundDb.ts",
];

// name -> "requireAdmin" | "requireSession", the first guard call in each
// (exported or internal) async function body.
function collectGuards(source) {
  const lines = source.split("\n");
  const out = [];
  let current = null;
  for (const line of lines) {
    const sig = line.match(/^(?:export )?(?:async )?function ([A-Za-z_]\w*)\s*[({<]/);
    if (sig) {
      current = { name: sig[1], guard: null };
      out.push(current);
      continue;
    }
    if (current && !current.guard) {
      const g = line.match(/await (requireAdmin|requireSession)\(\)/);
      if (g) current.guard = g[1];
    }
  }
  return out;
}

test("no mutation is guarded by requireSession", () => {
  const offenders = [];
  for (const rel of FILES) {
    const guards = collectGuards(readFileSync(join(root, rel), "utf8"));
    for (const { name, guard } of guards) {
      if (guard === "requireSession" && !VIEWER_READABLE.has(name)) {
        offenders.push(`${rel}: ${name}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these are behind requireSession but not on the viewer allow-list:\n${offenders.join("\n")}`,
  );
});

test("every viewer-readable function is actually guarded by requireSession", () => {
  const found = new Map();
  for (const rel of FILES) {
    for (const { name, guard } of collectGuards(readFileSync(join(root, rel), "utf8"))) {
      if (VIEWER_READABLE.has(name)) found.set(name, guard);
    }
  }
  const wrong = [];
  for (const name of VIEWER_READABLE) {
    const guard = found.get(name);
    if (guard !== "requireSession") wrong.push(`${name} -> ${guard ?? "MISSING"}`);
  }
  assert.deepEqual(wrong, [], `expected requireSession:\n${wrong.join("\n")}`);
});
