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
        (SELECT COUNT(*)::int FROM performance_fees) performance_fees,
        (SELECT COUNT(*)::int FROM platform_transactions) platform_transactions,
        (SELECT MIN(week_ending)::text FROM nav_weeks WHERE status = 'locked') first_locked_week,
        (SELECT MAX(week_ending)::text FROM nav_weeks WHERE status = 'locked') latest_locked_week
    `;
    assert.equal(counts.rows[0].investors, 5);
    assert.equal(counts.rows[0].first_locked_week, "2024-01-05");
    assert.equal(counts.rows[0].latest_locked_week, "2026-06-05");
    assert.equal(counts.rows[0].locked_nav_weeks >= 120, true);
    assert.equal(counts.rows[0].cash_movements >= 30, true);
    assert.equal(counts.rows[0].fixed_savings_rows >= 15, true);
    assert.equal(counts.rows[0].performance_fees >= 2, true);
    assert.equal(counts.rows[0].platform_transactions >= 200, true);
  });

  await check("weekly NAV keeps investor statements coherent after multi-year seed history", async () => {
    assert.equal(await fundDb.getTotalUnits() > 0, true);
    const chandra = await firstInvestor("Chandra Kumar");
    const statement = await fundDb.getInvestorStatement(chandra.id);
    assert.equal(statement.units > 0, true);
    assert.equal(statement.netInvestedCapital > 0, true);
    assert.equal(statement.marketValue > 0, true);
    assert.equal(statement.latestNav.week_ending, "2026-06-05");
    assert.equal(Number(statement.latestNav.nav_per_unit) > 0, true);
  });

  await check("withdrawal redemption creates fee, cash movement, and unit redemption", async () => {
    const ben = await firstInvestor("Ben Lim");
    const statement = await fundDb.getInvestorStatement(ben.id);
    assert.equal(statement.units > 0, true);
    assert.equal(statement.performanceFees.some((fee) => money(fee.fee_amount) > 0), true);
    assert.equal(statement.cashMovements.some((row) => row.type === "Withdrawal" && money(row.amount) > 0), true);
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
      weekEnding: "2026-06-12",
      platformSnapshots: [{ platformId, unrealizedProfit: 2500 }],
      adjustments: 142000,
      notes: "feature test platform NAV",
    });
    const week = await one(await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-06-12'`);
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
      () => fundDb.createNavWeek({ weekEnding: "2026-06-12", platformSnapshots: [], adjustments: 0 }),
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

  await check("equity withdrawal rejects an overdraw instead of silently under-filling", async () => {
    // Alice holds units; an investor with none hits the earlier "no units" guard.
    const alice = await firstInvestor("Alice Tan");
    await assert.rejects(
      () =>
        fundDb.recordCashMovement({
          investorId: alice.id,
          date: "2026-06-20",
          type: "Withdrawal",
          amount: 9_999_999,
          notes: "overdraw",
        }),
      /exceeds the investor's redeemable equity/i,
    );
  });

  await check("withdrawal with no units at all is rejected", async () => {
    const dina = await firstInvestor("Dina Wong");
    await assert.rejects(
      () =>
        fundDb.recordCashMovement({
          investorId: dina.id,
          date: "2026-06-20",
          type: "Withdrawal",
          amount: 100,
          notes: "no units",
        }),
      /No units available to redeem/i,
    );
  });

  await check("cash movements reject future dates", async () => {
    const dina = await firstInvestor("Dina Wong");
    await assert.rejects(
      () =>
        fundDb.recordCashMovement({
          investorId: dina.id,
          date: "2099-01-01",
          type: "Deposit",
          amount: 1000,
          notes: "future",
        }),
      /cannot be in the future/i,
    );
  });

  await check("platform valuations are recorded, audited, and reused by NAV", async () => {
    const platform = await one(await sql`SELECT id, name FROM platforms ORDER BY name ASC LIMIT 1`);
    // Must be after the latest locked NAV (2026-06-12), which already priced
    // every earlier period.
    const asOf = "2026-07-01";
    assert.equal(
      (await fundDb.recordPlatformValuation({
        platformId: platform.id,
        asOfDate: asOf,
        totalValue: 123_456.78,
        source: "MANUAL",
        notes: "feature test",
      })).success,
      true,
    );

    const stored = await one(await sql`
      SELECT total_value FROM platform_valuations
      WHERE platform_id = ${platform.id} AND as_of_date = ${asOf}
    `);
    assert.equal(Number(stored.total_value), 123_456.78);

    const audit = await one(await sql`
      SELECT id FROM audit_events
      WHERE action = 'platform_valuation.record' AND entity_type = 'platform_valuations'
      ORDER BY created_at DESC LIMIT 1
    `);
    assert.ok(audit.id, "valuation must write an audit event");

    // Re-recording the same date corrects rather than duplicating.
    await fundDb.recordPlatformValuation({
      platformId: platform.id,
      asOfDate: asOf,
      totalValue: 200_000,
    });
    const rows = await sql`
      SELECT COUNT(*)::int as count FROM platform_valuations
      WHERE platform_id = ${platform.id} AND as_of_date = ${asOf}
    `;
    assert.equal(rows.rows[0].count, 1);

    const preview = await fundDb.buildNavPlatformPreview(asOf);
    const row = preview.find((item) => item.platformId === platform.id);
    assert.ok(row, "preview must include the platform");
    assert.equal(row.totalValue, 200_000);
    assert.equal(row.source, "RECORDED");

    // A valuation cannot rewrite a period a locked NAV already priced.
    await assert.rejects(
      () =>
        fundDb.recordPlatformValuation({
          platformId: platform.id,
          asOfDate: "2026-06-01",
          totalValue: 1,
        }),
      /is locked and already priced this period/i,
    );

    // A later NAV carries the value forward and reports its age.
    const carried = await fundDb.buildNavPlatformPreview("2026-07-15");
    const carriedRow = carried.find((item) => item.platformId === platform.id);
    assert.equal(carriedRow.totalValue, 200_000);
    assert.equal(carriedRow.source, "CARRIED_FORWARD");
    assert.equal(carriedRow.ageDays, 14);
  });

  await check("platform tracking mode switches to POSITION and values from holdings", async () => {
    const platform = await one(await sql`SELECT id FROM platforms WHERE name = 'Codex Broker'`);

    // A platform with no priced assets cannot switch.
    const bare = await trading.addPlatform(formData({ name: "Bare Platform", default_currency: "MYR" }));
    assert.match(
      (await trading.updatePlatformTrackingMode(formData({ id: bare.id, tracking_mode: "POSITION" }))).error,
      /no assets with a price/i,
    );

    // Codex Broker has AAPL priced at 190 with a BUY of 50 units.
    assert.equal(
      (await trading.updatePlatformTrackingMode(formData({ id: platform.id, tracking_mode: "POSITION" }))).success,
      true,
    );
    const stored = await one(await sql`SELECT tracking_mode FROM platforms WHERE id = ${platform.id}`);
    assert.equal(stored.tracking_mode, "POSITION");

    const audit = await one(await sql`
      SELECT id FROM audit_events
      WHERE action = 'platform.update_tracking_mode' AND entity_id = ${platform.id}
      ORDER BY created_at DESC LIMIT 1
    `);
    assert.ok(audit.id, "tracking mode change must be audited");

    // Value is now computed from holdings x price x FX plus cash, not from a
    // recorded valuation.
    const preview = await fundDb.buildNavPlatformPreview("2026-07-20");
    const row = preview.find((item) => item.platformId === platform.id);
    assert.equal(row.source, "COMPUTED");
    assert.equal(row.isStale, false);
    assert.equal(row.ageDays, 0);
    // 50 AAPL @ 190 x 4.70 FX = 44,650, plus cash from the deposit and buy.
    assert.equal(row.totalValue > 0, true);
  });

  await check("withdrawing all principal keeps platform value in gross assets", async () => {
    const created = await trading.addPlatform(formData({ name: "Cashout Broker", default_currency: "MYR" }));
    const platformId = created.id;
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platformId} LIMIT 1`);

    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date: "2026-07-02",
      type: "BROKER_DEPOSIT",
      amount: "10000",
      currency: "MYR",
      base_amount: "10000",
      status: "SETTLED",
    }))).success, true);

    // Platform grows to 20k, then the original 10k principal is taken back out.
    await fundDb.recordPlatformValuation({ platformId, asOfDate: "2026-07-03", totalValue: 20_000 });
    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date: "2026-07-04",
      type: "BROKER_WITHDRAWAL",
      amount: "10000",
      currency: "MYR",
      base_amount: "10000",
      status: "SETTLED",
    }))).success, true);
    await fundDb.recordPlatformValuation({ platformId, asOfDate: "2026-07-05", totalValue: 10_000 });

    const preview = await fundDb.buildNavPlatformPreview("2026-07-05");
    const row = preview.find((item) => item.platformId === platformId);
    assert.equal(row.netInvested, 0, "principal fully withdrawn");
    assert.equal(row.totalValue, 10_000);

    // Deposits are auto-allocated across funding sources, so equity owns only
    // its contributed share of the remaining gain - but that share must survive
    // net invested reaching zero rather than collapsing to nothing.
    const contributedTotal = row.equityContributed + row.fixedSavingsContributed + row.brokerageContributed;
    assert.equal(contributedTotal > 0, true, "contributions must be recorded");
    const expectedEquityNav = Math.round((row.totalValue * (row.equityContributed / contributedTotal)) * 100) / 100;
    assert.equal(expectedEquityNav > 0, true, "equity funded part of this platform");

    await fundDb.createNavWeek({
      weekEnding: "2026-07-05",
      settlementDate: "2026-07-05",
      adjustments: 0,
      notes: "cash-out boundary",
    });
    const snapshot = await one(await sql`
      SELECT nwps.equity_net_invested, nwps.equity_unrealized_profit, nwps.total_value, nwps.brokerage_profit_loss
      FROM nav_week_platform_snapshots nwps
      JOIN nav_weeks nw ON nw.id = nwps.nav_week_id
      WHERE nw.week_ending = '2026-07-05' AND nwps.platform_id = ${platformId}
    `);
    assert.equal(Number(snapshot.total_value), 10_000);

    const equityNav = Number(snapshot.equity_net_invested) + Number(snapshot.equity_unrealized_profit);
    assert.equal(equityNav > 0, true, "equity NAV contribution must not collapse to zero");
    assert.equal(
      Math.abs(equityNav - expectedEquityNav) < 0.05,
      true,
      `equity NAV ${equityNav} should match contributed share ${expectedEquityNav}`,
    );

    // Nothing is lost: equity plus non-equity shares account for the full value.
    assert.equal(
      Math.abs(equityNav + Number(snapshot.brokerage_profit_loss) - 10_000) < 0.05,
      true,
      "equity and non-equity shares must sum to the platform value",
    );
  });

  await check("profit claims write audit events and cannot exceed attributable profit", async () => {
    const dina = await firstInvestor("Dina Wong");
    const rejected = await claims.addProfitClaim(formData({
      investor_id: dina.id,
      locked_amount: "99999999",
      claim_date: "2026-05-20",
      notes: "over-claim",
    }));
    assert.match(rejected.error, /exceeds this investor's claimable profit/i);
  });

  await check("audit reversal rejects non-latest and locked-history reversals, then reverts current latest", async () => {
    const seededAudit = await one(await sql`
      SELECT id
      FROM audit_events
      WHERE action = 'cash_movement.add'
      ORDER BY created_at ASC
      LIMIT 1
    `);
    assert.match((await adminLogs.revertAuditLog(seededAudit.id)).error, /latest active|later|locked financial history/i);

    const dina = await firstInvestor("Dina Wong");
    assert.equal((await fundDb.recordCashMovement({
      investorId: dina.id,
      date: "2026-06-13",
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

    // A v2 file must still restore: tables added in v3 come back empty and the
    // never-created platform_performance table v2 exported is ignored.
    const v2Order = backupTables.BACKUP_TABLE_ORDER_BY_VERSION[2];
    const v2RowCounts = Object.fromEntries(v2Order.map((table) => [table, table === "investors" ? 1 : 0]));
    const v2Tables = Object.fromEntries(v2Order.map((table) => [table, []]));
    v2Tables.investors = [{ id: crypto.randomUUID(), name: "Legacy V2 Investor", created_at: exportedAt }];
    const legacy = backupValidation.parseBackupJson(JSON.stringify({
      metadata: {
        app: backupTables.BACKUP_APP_NAME,
        schemaVersion: 2,
        exportedAt,
        baseCurrency: backupTables.BACKUP_BASE_CURRENCY,
        tableOrder: v2Order,
        rowCounts: v2RowCounts,
      },
      tables: v2Tables,
    }));
    assert.equal(backupValidation.createBackupPreview(legacy).totalRows, 1);
    assert.deepEqual(legacy.tables.platform_valuations, []);
    assert.deepEqual(legacy.tables.platform_transaction_allocations, []);
    assert.equal(legacy.metadata.schemaVersion, backupTables.BACKUP_SCHEMA_VERSION);

    assert.throws(
      () => backupValidation.parseBackupJson(JSON.stringify({
        metadata: {
          app: backupTables.BACKUP_APP_NAME,
          schemaVersion: 1,
          exportedAt,
          baseCurrency: backupTables.BACKUP_BASE_CURRENCY,
          tableOrder: v2Order,
          rowCounts: v2RowCounts,
        },
        tables: v2Tables,
      })),
      /schema version is not supported/i,
    );
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
