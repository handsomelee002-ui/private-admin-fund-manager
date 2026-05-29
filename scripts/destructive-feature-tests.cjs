/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  createRunner,
  formData,
  installTsRuntime,
  loadDotEnv,
  money,
} = require("./test-runtime.cjs");

loadDotEnv();
installTsRuntime({ mockAuth: true });

const { sql } = require("@vercel/postgres");
const fundDb = require("../src/lib/fundDb.ts");
const trading = require("../src/actions/trading.ts");
const investors = require("../src/actions/investors.ts");
const claims = require("../src/actions/profitClaims.ts");
const settings = require("../src/actions/settings.ts");
const capital = require("../src/actions/capital.ts");
const adminLogs = require("../src/actions/adminLogs.ts");
const backups = require("../src/actions/backups.ts");
const backupValidation = require("../src/lib/backupValidation.ts");
const backupTables = require("../src/lib/backupTables.ts");
const investmentAccounting = require("../src/lib/investmentAccounting.ts");
const tableSorting = require("../src/lib/tableSorting.ts");

const { check, report } = createRunner();

async function one(result) {
  return result.rows[0];
}

async function firstInvestor(name) {
  return one(await sql`SELECT id FROM investors WHERE name = ${name}`);
}

(async () => {
  await check("database reset and deterministic seed", async () => {
    await fundDb.seedDummyData();
    const counts = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM investors) investors,
        (SELECT COUNT(*)::int FROM nav_weeks WHERE status = 'locked') locked_nav_weeks,
        (SELECT COUNT(*)::int FROM cash_movements) cash_movements,
        (SELECT COUNT(*)::int FROM fixed_savings_ledger) fixed_savings_rows,
        (SELECT COUNT(*)::int FROM performance_fees) performance_fees
    `;
    assert.deepEqual(counts.rows[0], {
      investors: 3,
      locked_nav_weeks: 3,
      cash_movements: 4,
      fixed_savings_rows: 1,
      performance_fees: 2,
    });
  });

  await check("weekly NAV protects late investors from prior-period gains", async () => {
    assert.equal(await fundDb.getTotalUnits(), 114436.619718);
    const chandra = await firstInvestor("Chandra Kumar");
    const statement = await fundDb.getInvestorStatement(chandra.id);
    assert.equal(statement.units, 25000);
    assert.equal(statement.netInvestedCapital, 28000);
    assert.equal(statement.marketValue, 28400);
    assert.equal(Number(statement.latestNav.nav_per_unit), 1.136);
  });

  await check("withdrawal redemption creates fee, cash movement, and unit redemption", async () => {
    const ben = await firstInvestor("Ben Lim");
    const statement = await fundDb.getInvestorStatement(ben.id);
    assert.equal(statement.units, 29436.619718);
    assert.equal(statement.performanceFees.some((fee) => money(fee.fee_amount) === 28.73), true);
    assert.equal(statement.cashMovements.some((row) => row.type === "Withdrawal" && money(row.amount) === 12000), true);
  });

  await check("investor CRUD guardrails reject duplicates, forbid hard delete, and rotate portal access", async () => {
    assert.match((await investors.addInvestor(formData({ name: "Alice Tan" }))).error, /already exists/i);
    assert.deepEqual(await investors.addInvestor(formData({ name: "Dina Wong" })), { success: true });
    const dina = await one(await sql`SELECT id, portal_access_id FROM investors WHERE name = 'Dina Wong'`);
    const rotated = await investors.rotateInvestorPortalAccess(dina.id);
    assert.equal(rotated.success, true);
    assert.notEqual(rotated.portalAccessId, dina.portal_access_id);
    assert.match((await investors.deleteInvestor(dina.id)).error, /cannot be hard-deleted/i);
  });

  await check("trading platform, account, asset, transaction, and performance workflow", async () => {
    const platformResult = await trading.addPlatform(formData({ name: "Codex Broker", default_currency: "USD" }));
    assert.equal(platformResult.success, true);
    const platformId = platformResult.id;
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platformId} AND currency = 'USD'`);

    assert.equal((await trading.addPlatformAsset(formData({
      platform_id: platformId,
      symbol: "AAPL",
      name: "Apple Inc",
      asset_type: "SECURITY",
      currency: "USD",
      latest_price: "190",
      latest_fx_rate_to_myr: "4.70",
    }))).success, true);
    const asset = await one(await sql`SELECT id FROM platform_assets WHERE platform_id = ${platformId} AND symbol = 'AAPL'`);

    assert.match((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      date: "2026-05-20",
      type: "BUY",
      amount: "1000",
      currency: "MYR",
    }))).error, /Trades require asset/i);
    assert.match((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      date: "2026-05-20",
      type: "FX_CONVERSION",
      amount: "1000",
      currency: "USD",
      base_amount: "4700",
    }))).error, /FX conversion requires/i);

    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date: "2026-05-20",
      type: "BROKER_DEPOSIT",
      amount: "5000",
      currency: "USD",
      base_amount: "20000",
      status: "SETTLED",
    }))).success, true);
    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      asset_id: asset.id,
      date: "2026-05-21",
      type: "BUY",
      amount: "9500",
      currency: "MYR",
      quantity: "50",
      price_per_unit: "190",
      fee_amount: "10",
      tax_amount: "5",
      status: "SETTLED",
    }))).success, true);

    await fundDb.createNavWeek({
      weekEnding: "2026-05-22",
      platformSnapshots: [{ platformId, unrealizedProfit: 2500 }],
      adjustments: 142000,
      notes: "feature test platform NAV",
    });
    const week = await one(await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-05-22'`);
    await fundDb.lockNavWeek(week.id);

    const performance = await trading.getPlatformPerformance(platformId);
    assert.equal(performance.totalDeposits, 20000);
    assert.equal(performance.netInvested, 20000);
    assert.equal(performance.currentValue, 22500);
    assert.equal(performance.latestUnrealized, 2500);
    assert.equal(performance.simpleRoi, 12.5);
  });

  await check("NAV create and lock rejects locked-week modification", async () => {
    await assert.rejects(
      () => fundDb.createNavWeek({ weekEnding: "2026-05-22", platformSnapshots: [], adjustments: 0 }),
      /Locked NAV weeks cannot be modified/,
    );
  });

  await check("fixed savings deposit, withdrawal, and liability calculation", async () => {
    const alice = await firstInvestor("Alice Tan");
    assert.equal((await fundDb.recordFixedSavings({
      investorId: alice.id,
      date: "2026-06-01",
      type: "Deposit",
      amount: 5000,
      annualRatePercent: 4.25,
      notes: "feature test deposit",
    })).success, true);
    assert.equal((await fundDb.recordFixedSavings({
      investorId: alice.id,
      date: "2026-06-10",
      type: "Withdrawal",
      amount: 1000,
      notes: "feature test withdrawal",
    })).success, true);
    await assert.rejects(
      () => fundDb.recordFixedSavings({ investorId: alice.id, date: "2026-06-11", type: "Withdrawal", amount: 999999 }),
      /exceeds available fixed savings balance/,
    );
    const statement = await fundDb.getInvestorStatement(alice.id);
    assert.equal(statement.savingsPrincipal >= 19000, true);
    assert.equal(statement.savingsBalance >= statement.savingsPrincipal, true);
  });

  await check("brokerage settings drive claim creation and settlement ledger", async () => {
    assert.equal((await settings.updateBrokerageFeeRate(formData({ brokerage_fee_pct: "3.5" }))).success, true);
    assert.equal(await settings.getBrokerageFeeRate(), 3.5);
    const alice = await firstInvestor("Alice Tan");
    const created = await claims.addProfitClaim(formData({
      investor_id: alice.id,
      locked_amount: "1000",
      claim_date: "2026-05-23",
      notes: "feature test claim",
    }));
    assert.equal(created.success, true);
    assert.equal(created.brokerageFee, 35);
    assert.equal(created.netAmount, 965);
    const claim = await one(await sql`
      SELECT id
      FROM investor_profit_claims
      WHERE investor_id = ${alice.id} AND locked_amount = 1000
      ORDER BY created_at DESC
      LIMIT 1
    `);
    assert.equal((await claims.settleClaim(formData({
      id: claim.id,
      settled_amount: "500",
      settled_date: "2026-05-24",
      notes: "partial",
    }))).netPaid, 500);
    const full = await claims.settleClaim(formData({
      id: claim.id,
      settled_amount: "9999",
      settled_date: "2026-05-25",
      notes: "full",
    }));
    assert.equal(full.success, true);
    assert.equal(full.netPaid, 465);
    assert.equal(full.brokerageFee, 35);
  });

  await check("capital withdrawal blocks overdraw and auto-locks positive unrealized claim", async () => {
    const dina = await firstInvestor("Dina Wong");
    assert.equal((await capital.addCapitalRecord(formData({
      investor_id: dina.id,
      date: "2026-05-20",
      type: "Deposit",
      amount: "10000",
      notes: "capital test",
    }))).success, true);
    assert.match((await capital.addCapitalRecord(formData({
      investor_id: dina.id,
      date: "2026-05-21",
      type: "Withdrawal",
      amount: "999999",
      notes: "blocked",
    }))).error, /exceeds/i);
    const withdrawal = await capital.addCapitalRecord(formData({
      investor_id: dina.id,
      date: "2026-05-22",
      type: "Withdrawal",
      amount: "1000",
      notes: "allowed",
    }));
    assert.equal(withdrawal.success, true);
    assert.equal(withdrawal.autoClaimedAmount > 0, true);
  });

  await check("audit reversal rejects non-latest and locked-history reversals, then reverts current latest", async () => {
    const seededAudit = await one(await sql`
      SELECT id
      FROM audit_events
      WHERE action = 'cash_movement.add'
      ORDER BY created_at ASC
      LIMIT 1
    `);
    assert.match((await adminLogs.revertAuditLog(seededAudit.id)).error, /later|locked financial history/i);

    const dina = await firstInvestor("Dina Wong");
    assert.equal((await fundDb.recordCashMovement({
      investorId: dina.id,
      date: "2026-06-01",
      type: "Deposit",
      amount: 1000,
      notes: "reversal feature test",
    })).success, true);
    const audit = await one(await sql`
      SELECT id, entity_id
      FROM audit_events
      WHERE action = 'cash_movement.add' AND details->>'amount' = '1000'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    assert.equal((await adminLogs.revertAuditLog(audit.id)).success, true);
    assert.equal((await one(await sql`SELECT audit_status FROM cash_movements WHERE id = ${audit.entity_id}`)).audit_status, "reverted");
    assert.match((await adminLogs.revertAuditLog(audit.id)).error, /already been reverted/i);
  });

  await check("portal access rate limit blocks excessive attempts", async () => {
    const alice = await firstInvestor("Alice Tan");
    const portalId = `portal_rate_${Date.now()}`;
    const portalHash = crypto.createHash("sha256").update(portalId).digest("base64url");
    await sql`UPDATE investors SET portal_access_id = ${portalId}, portal_access_rotated_at = NOW() WHERE id = ${alice.id}`;
    for (let i = 0; i < 120; i += 1) {
      await sql`
        INSERT INTO portal_access_events (investor_id, portal_access_hash, client_key, user_agent, outcome)
        VALUES (${alice.id}, ${portalHash}, 'feature-rate-limit', 'feature-test', 'not_found')
      `;
    }
    await assert.rejects(
      () => fundDb.getInvestorStatementByPortalAccessId(portalId, { clientKey: "feature-rate-limit", userAgent: "feature-test" }),
      /Too many portal access attempts/,
    );
  });

  await check("backup export, validation, restore round trip, and reference validation", async () => {
    const backup = await backups.exportFundBackup(formData({ admin_password: "ignored-by-test-runtime" }));
    assert.match(backup.fileName, /^fund-backup-/);
    const parsed = backupValidation.parseBackupJson(backup.json);
    backupValidation.validateBackupReferences(parsed);

    await sql`INSERT INTO investors (name) VALUES ('Transient Restore Casualty')`;
    assert.equal((await one(await sql`SELECT COUNT(*)::int count FROM investors WHERE name = 'Transient Restore Casualty'`)).count, 1);
    const restored = await backups.restoreFundBackup(formData({
      admin_password: "ignored-by-test-runtime",
      confirmation: "IMPORT BACKUP",
      backup_json: backup.json,
    }));
    assert.equal(restored.success, true);
    assert.equal((await one(await sql`SELECT COUNT(*)::int count FROM investors WHERE name = 'Transient Restore Casualty'`)).count, 0);

    const exportedAt = new Date().toISOString();
    const rowCounts = Object.fromEntries(backupTables.BACKUP_TABLES.map((table) => [table, table === "investors" ? 1 : 0]));
    const tables = Object.fromEntries(backupTables.BACKUP_TABLES.map((table) => [table, []]));
    tables.investors = [{ id: crypto.randomUUID(), name: "Backup Investor", created_at: exportedAt }];
    const minimal = backupValidation.parseBackupJson(JSON.stringify({
      metadata: {
        app: backupTables.BACKUP_APP_NAME,
        schemaVersion: backupTables.BACKUP_SCHEMA_VERSION,
        exportedAt,
        baseCurrency: backupTables.BACKUP_BASE_CURRENCY,
        tableOrder: backupTables.BACKUP_TABLES,
        rowCounts,
      },
      tables,
    }));
    assert.equal(backupValidation.createBackupPreview(minimal).totalRows, 1);
    minimal.tables.cash_movements.push({
      id: crypto.randomUUID(),
      investor_id: crypto.randomUUID(),
      date: "2026-05-01",
      type: "Deposit",
      amount: 1,
    });
    assert.throws(() => backupValidation.validateBackupReferences(minimal), /missing investor/i);
  });

  await check("pure investment accounting and table sorting edge cases", async () => {
    assert.equal(investmentAccounting.isInvestmentTransactionType("BUY"), true);
    assert.equal(investmentAccounting.isInvestmentTransactionType("BAD"), false);
    assert.equal(investmentAccounting.signedCashFlow("BROKER_DEPOSIT", 100), -100);
    assert.equal(investmentAccounting.signedCashFlow("DIVIDEND", 100), 100);
    assert.equal(investmentAccounting.percentage(25, 200), 12.5);
    assert.equal(investmentAccounting.percentage(1, 0), null);
    const xirr = investmentAccounting.calculateXirr([
      { date: "2026-01-01", amount: -1000 },
      { date: "2027-01-01", amount: 1100 },
    ]);
    assert.equal(Math.abs(xirr - 0.1) < 0.001, true);
    const state = tableSorting.getSortState({ sort: "name", dir: "asc" }, ["name", "amount"], { sort: "amount", dir: "desc" });
    assert.deepEqual(state, { sort: "name", dir: "asc" });
    assert.deepEqual(
      tableSorting.sortRows([{ name: "b", amount: "2" }, { name: "a", amount: "10" }], state, {
        name: (row) => row.name,
        amount: (row) => row.amount,
      }).map((row) => row.name),
      ["a", "b"],
    );
  });

  const ok = report("feature tests");
  await sql.end?.();
  if (!ok) process.exitCode = 1;
})().catch(async (error) => {
  console.error(error?.stack || error);
  await sql.end?.();
  process.exit(1);
});
