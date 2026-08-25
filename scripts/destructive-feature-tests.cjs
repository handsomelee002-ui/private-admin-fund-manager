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
      date: "2026-06-08",
      type: "BUY",
      amount: "1000",
      currency: "MYR",
    }))).error, /Trades require asset/i);
    assert.match((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      date: "2026-06-08",
      type: "FX_CONVERSION",
      amount: "1000",
      currency: "USD",
      base_amount: "4700",
    }))).error, /FX conversion requires/i);

    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date: "2026-06-08",
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
      date: "2026-06-09",
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

  await check("platform positions are struck on the NAV date, not on today", async () => {
    const created = await trading.addPlatform(formData({ name: "Cutoff Broker", default_currency: "MYR" }));
    assert.equal(created.success, true);
    const platformId = created.id;
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platformId} LIMIT 1`);

    const deposit = async (date, base) => assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date,
      type: "BROKER_DEPOSIT",
      amount: base,
      currency: "MYR",
      base_amount: base,
      status: "SETTLED",
    }))).success, true);

    await deposit("2026-08-01", "10000");
    await deposit("2026-08-20", "5000");

    // The second deposit is dated after the NAV date. Counting it would make
    // net invested 15,000 against a mark taken on the 10th, pricing 5,000 of
    // capital that had not arrived yet as a loss.
    const preview = await fundDb.buildNavPlatformPreview("2026-08-10");
    const onDate = preview.find((row) => row.platformId === platformId);
    assert.equal(money(onDate.netInvested), 10000, "post-date transactions must not leak into a NAV date");

    const later = await fundDb.buildNavPlatformPreview("2026-08-21");
    assert.equal(money(later.find((row) => row.platformId === platformId).netInvested), 15000);
  });

  await check("closing a broker account marks it at zero and realises the loss", async () => {
    const platform = await one(await sql`SELECT id FROM platforms WHERE name = 'Cutoff Broker'`);
    await fundDb.recordPlatformValuation({
      platformId: platform.id,
      asOfDate: "2026-08-05",
      totalValue: 12000,
    });

    const live = await fundDb.buildNavPlatformPreview("2026-08-10");
    assert.equal(money(live.find((row) => row.platformId === platform.id).totalValue), 12000);

    await fundDb.closePlatform({ platformId: platform.id, asOfDate: "2026-08-15", notes: "feature close" });

    // Marked at zero, and no longer stale - a dead account nobody will ever
    // value again must not wedge every future NAV lock behind a missing mark.
    const closed = await fundDb.buildNavPlatformPreview("2026-08-21");
    const row = closed.find((item) => item.platformId === platform.id);
    assert.equal(money(row.totalValue), 0);
    assert.equal(row.isStale, false);
    assert.equal(money(row.profitLoss), -15000, "everything the account still held is now a realised loss");

    // Closing twice, and booking money into a dead account, must both refuse.
    await assert.rejects(
      () => fundDb.closePlatform({ platformId: platform.id, asOfDate: "2026-08-16" }),
      /already closed/i,
    );
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platform.id} LIMIT 1`);
    const blocked = await trading.addPlatformTransaction(formData({
      platform_id: platform.id,
      account_id: account.id,
      date: "2026-08-18",
      type: "BROKER_DEPOSIT",
      amount: "1000",
      currency: "MYR",
      base_amount: "1000",
      status: "SETTLED",
    }));
    assert.match(blocked.error, /was closed on 2026-08-15/i);

    // Reopening restores the earlier mark. The zero valuation the close wrote
    // stays on record, so dates on or after it still read zero until a fresh
    // valuation is taken.
    await fundDb.reopenPlatform(platform.id);
    const reopened = await fundDb.buildNavPlatformPreview("2026-08-10");
    assert.equal(money(reopened.find((item) => item.platformId === platform.id).totalValue), 12000);
    await assert.rejects(() => fundDb.reopenPlatform(platform.id), /is not closed/i);

    // Remove the fixture. Reopening leaves the close's zero valuation in place
    // by design, so this platform would otherwise sit at 15,000 invested and
    // valued at nothing - a phantom loss the pot absorbs on savers' share of it,
    // which later checks would read as the fund genuinely deploying from
    // brokerage. Cascades clean up its accounts, transactions and valuations.
    await sql`DELETE FROM platforms WHERE name = 'Cutoff Broker'`;
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

  await check("brokerage withdrawal is capped, writes both legs, and agrees across screens", async () => {
    // Every screen must quote the same pot. This is the whole point of the
    // shared balance function - the three implementations had drifted apart.
    const pot = await fundDb.getBrokerageBalance();
    const basis = await trading.getPlatformCapitalAllocation((await one(await sql`SELECT id FROM platforms LIMIT 1`)).id);
    const availability = await fundDb.getFundCashAvailability();
    assert.equal(availability.brokerage.claim, pot.balance);
    // The pot is no longer capital a deposit can draw on, so it must not appear
    // in the funding basis at all - a zero there would read as "nothing left"
    // rather than "not a funding source".
    assert.equal("brokerage" in basis.automaticBasis, false);

    // A pot with nothing realised must refuse, not pay out of the bank.
    if (pot.withdrawable <= 0) {
      await assert.rejects(
        () => fundDb.recordBrokerageWithdrawal({ date: "2026-07-04", amount: 1, notes: "should refuse" }),
        /no realised profit to withdraw|in deficit/i,
      );
    }

    // Put the pot in credit so the paying path is genuinely exercised rather
    // than only ever testing the refusal branch.
    await sql`INSERT INTO brokerage_withdrawals (date, amount, notes) VALUES ('2026-07-01', -50000, 'test credit')`;
    const funded = await fundDb.getBrokerageBalance();
    assert.equal(funded.balance > 0, true, `expected a positive pot, got ${funded.balance}`);

    // The two capital accounts must foot to the balance NAV prices the pot at,
    // and cash out may never exceed either limb of the test.
    assert.equal(money(funded.realisedPot + funded.unrealisedPot), money(funded.balance));
    assert.equal(
      money(funded.platformProfitLossRealised + funded.platformProfitLossUnrealised),
      money(funded.platformProfitLoss),
    );
    assert.equal(funded.withdrawable <= funded.balance + 0.005, true, "withdrawable must not exceed the balance");
    assert.equal(
      funded.withdrawable <= Math.max(0, funded.realisedPot) + 0.005,
      true,
      "withdrawable must not exceed realised profit",
    );

    await assert.rejects(
      () => fundDb.recordBrokerageWithdrawal({ date: "2026-07-04", amount: funded.withdrawable + 1000 }),
      /exceeds the RM .* of realised profit available/i,
    );
    await assert.rejects(
      () => fundDb.recordBrokerageWithdrawal({ date: "2026-07-04", amount: -5 }),
      /must be a positive number/i,
    );

    const cashBefore = (await fundDb.getFundCashAsOf("2026-07-04")).balance;
    const take = Math.min(500, funded.withdrawable);
    const result = await fundDb.recordBrokerageWithdrawal({ date: "2026-07-04", amount: take, notes: "feature test" });
    assert.equal(result.amount, take);

    // Both legs, or equity silently absorbs the difference.
    const potAfter = await fundDb.getBrokerageBalance();
    assert.equal(money(potAfter.balance), money(funded.balance - take));
    assert.equal(money(potAfter.withdrawals), money(funded.withdrawals + take));
    const cashAfter = (await fundDb.getFundCashAsOf("2026-07-04")).balance;
    assert.equal(money(cashAfter), money(cashBefore - take));

    // The availability card still reconciles to the bank after the withdrawal.
    const after = await fundDb.getFundCashAvailability("2026-07-04");
    const summed = after.equity.available + after.fixedSavings.available + after.brokerage.available;
    assert.equal(money(summed), money(after.bankBalance));

    const listed = await fundDb.getBrokerageWithdrawals();
    assert.equal(listed.some((row) => row.date === "2026-07-04" && Number(row.amount) === take), true);

    // Realised and unrealised must still foot to the balance after cash moves,
    // and cash withdrawn is a realised-side item only.
    const potFinal = await fundDb.getBrokerageBalance();
    assert.equal(money(potFinal.realisedPot + potFinal.unrealisedPot), money(potFinal.balance));
    assert.equal(money(potFinal.unrealisedPot), money(funded.unrealisedPot), "cash out must not move the mark");
    assert.equal(money(potFinal.realisedPot), money(funded.realisedPot - take));

    const rows = await fundDb.getBrokerageWithdrawals();
    assert.equal(rows.some((row) => row.notes === "feature test" && row.type === "CASH"), true);

    await sql`DELETE FROM brokerage_withdrawals WHERE notes IN ('test credit', 'feature test')`;
  });

  await check("brokerage is retired as a funding source but old money can still come out", async () => {
    // The seed used to send 30% of every platform flow to brokerage, deploying
    // principal the pot never held. Nothing may fund from it now.
    const seeded = await sql`
      SELECT COALESCE(SUM(base_amount), 0) as total
      FROM platform_transaction_allocations WHERE funding_source = 'brokerage'
    `;
    assert.equal(Number(seeded.rows[0].total), 0, "seed still funds platforms from brokerage");
    const legacyTx = await sql`SELECT COUNT(*) as n FROM platform_transactions WHERE funding_source = 'brokerage'`;
    assert.equal(Number(legacyTx.rows[0].n), 0, "seed still marks transactions brokerage-funded");

    // No pool may be deployed beyond what it owns. Sending the freed 30% to
    // fixed savings instead would have recreated the same inversion.
    const availability = await fundDb.getFundCashAvailability();
    assert.equal(
      availability.fixedSavings.deployed <= availability.fixedSavings.claim + 0.005,
      true,
      `savers deployed ${availability.fixedSavings.deployed} against a claim of ${availability.fixedSavings.claim}`,
    );
    assert.equal(availability.brokerage.deployed, 0);
    assert.equal(availability.brokerage.unbackedPrincipal, 0);

    const platformId = (await one(await sql`SELECT id FROM platforms LIMIT 1`)).id;
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platformId} LIMIT 1`);

    // A manual allocation naming brokerage is refused rather than quietly
    // dropped, so the operator finds out the source is gone.
    const refused = await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account ? account.id : "",
      date: "2026-06-20",
      type: "BROKER_DEPOSIT",
      amount: "1000",
      base_amount: "1000",
      currency: "MYR",
      status: "SETTLED",
      allocation_mode: "manual",
      allocation_equity_pct: "50",
      allocation_fixed_savings_pct: "20",
      allocation_brokerage_pct: "30",
    }));
    assert.match(refused.error, /no longer a funding source/i);

    // Automatic allocation splits across the two live pools and totals 100%.
    const auto = await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account ? account.id : "",
      date: "2026-06-20",
      type: "BROKER_DEPOSIT",
      amount: "1000",
      base_amount: "1000",
      currency: "MYR",
      status: "SETTLED",
      allocation_mode: "automatic",
    }));
    assert.equal(auto.success, true, auto.error);
    const split = await sql`
      SELECT pta.funding_source, pta.ratio_percent
      FROM platform_transaction_allocations pta
      JOIN platform_transactions pt ON pt.id = pta.transaction_id
      WHERE pt.platform_id = ${platformId} AND pt.date = '2026-06-20' AND pt.base_amount = 1000
    `;
    assert.equal(split.rows.length > 0, true, "automatic allocation wrote no rows");
    assert.equal(split.rows.some((row) => row.funding_source === "brokerage"), false);
    assert.equal(
      money(split.rows.reduce((sum, row) => sum + Number(row.ratio_percent), 0)),
      100,
      "automatic allocation ratios do not total 100%",
    );

    // Money that went in under the retired source must still be able to come
    // back out, or a restored backup would strand it in the platform forever.
    const withdrawalTx = await one(await sql`
      SELECT id FROM platform_transactions
      WHERE platform_id = ${platformId} AND date = '2026-06-20' AND base_amount = 1000
      ORDER BY created_at DESC LIMIT 1
    `);
    await sql`
      UPDATE platform_transaction_allocations
      SET funding_source = 'brokerage'
      WHERE transaction_id = ${withdrawalTx.id}
        AND funding_source = (
          SELECT funding_source FROM platform_transaction_allocations
          WHERE transaction_id = ${withdrawalTx.id} ORDER BY base_amount DESC LIMIT 1
        )
    `;
    const balances = await trading.getPlatformCapitalAllocation(platformId);
    assert.equal(
      balances.platformAllocations.some((row) => row.source === "brokerage" && row.baseAmount > 0),
      true,
      "legacy brokerage principal vanished from the platform view",
    );

    await sql`DELETE FROM platform_transaction_allocations WHERE transaction_id = ${withdrawalTx.id}`;
    await sql`DELETE FROM platform_transactions WHERE id = ${withdrawalTx.id}`;
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

  await check("money out is capped by platform value, not by principal", async () => {
    const created = await trading.addPlatform(formData({ name: "Dividend Broker", default_currency: "MYR" }));
    const platformId = created.id;
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platformId} LIMIT 1`);
    const moneyOut = (amount, date) => trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date,
      type: "BROKER_WITHDRAWAL",
      amount: String(amount),
      currency: "MYR",
      base_amount: String(amount),
      status: "SETTLED",
    }));

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

    // Never valued: the ceiling is what went in.
    assert.match((await moneyOut(12000, "2026-07-03")).error, /exceeds the RM 10000\.00 put into this platform/);

    // Worth 15k after a dividend: taking the dividend out must be allowed, even
    // though it is more than the principal still notionally in there.
    await fundDb.recordPlatformValuation({ platformId, asOfDate: "2026-07-03", totalValue: 15000 });
    assert.equal((await moneyOut(12000, "2026-07-04")).success, true, "profit withdrawal must be recordable");

    // Beyond the recorded value is still refused.
    assert.match((await moneyOut(9000, "2026-07-05")).error, /exceeds this platform.s recorded value/);

    // Net invested is now negative; the platform must still carry its value.
    await fundDb.recordPlatformValuation({ platformId, asOfDate: "2026-07-06", totalValue: 3000 });
    const preview = await fundDb.buildNavPlatformPreview("2026-07-06");
    const row = preview.find((item) => item.platformId === platformId);
    assert.equal(row.netInvested, -2000);
    assert.equal(row.totalValue, 3000);
  });

  await check("fund cash is recorded, carried forward, and lands in gross assets", async () => {
    assert.equal((await fundDb.recordFundCash({ asOfDate: "2026-07-10", balance: 25000 })).success, true);

    const audit = await one(await sql`
      SELECT id FROM audit_events WHERE action = 'fund_cash.record' ORDER BY created_at DESC LIMIT 1
    `);
    assert.ok(audit.id, "fund cash must be audited");

    const sameDay = await fundDb.getFundCashAsOf("2026-07-10");
    assert.equal(sameDay.balance, 25000);
    assert.equal(sameDay.source, "RECORDED");
    assert.equal(sameDay.ageDays, 0);

    const carried = await fundDb.getFundCashAsOf("2026-07-24");
    assert.equal(carried.balance, 25000);
    assert.equal(carried.source, "CARRIED_FORWARD");
    assert.equal(carried.ageDays, 14);

    await fundDb.createNavWeek({ weekEnding: "2026-07-24", adjustments: 0, notes: "fund cash test" });
    const week = await one(await sql`
      SELECT gross_assets, fund_cash FROM nav_weeks WHERE week_ending = '2026-07-24'
    `);
    assert.equal(parseFloat(week.fund_cash), 25000);

    // Recording no cash at all would have lost this money entirely.
    await fundDb.createNavWeek({ weekEnding: "2026-07-25", fundCash: 0, adjustments: 0 });
    const bare = await one(await sql`SELECT gross_assets FROM nav_weeks WHERE week_ending = '2026-07-25'`);
    assert.equal(
      Math.round((parseFloat(week.gross_assets) - parseFloat(bare.gross_assets)) * 100) / 100,
      25000,
      "gross assets must differ by exactly the fund cash",
    );
  });

  await check("expected fund cash tracks money leaving and entering platforms", async () => {
    const created = await trading.addPlatform(formData({ name: "Flow Broker", default_currency: "MYR" }));
    const platformId = created.id;
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platformId} LIMIT 1`);

    await fundDb.recordFundCash({ asOfDate: "2026-08-01", balance: 50000 });
    const baseline = await fundDb.getFundCashAsOf("2026-08-01");
    assert.equal(baseline.expectedBalance, 50000);

    // Money into a platform leaves the fund cash account.
    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date: "2026-08-02",
      type: "BROKER_DEPOSIT",
      amount: "8000",
      currency: "MYR",
      base_amount: "8000",
      status: "SETTLED",
    }))).success, true);

    const afterDeposit = await fundDb.getFundCashAsOf("2026-08-02");
    assert.equal(afterDeposit.balance, 50000, "balance is still the last recorded one");
    assert.equal(afterDeposit.expectedBalance, 42000, "expected drops by the deposit");

    // Money out of a platform comes back to the fund cash account.
    await fundDb.recordPlatformValuation({ platformId, asOfDate: "2026-08-03", totalValue: 8000 });
    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date: "2026-08-04",
      type: "BROKER_WITHDRAWAL",
      amount: "3000",
      currency: "MYR",
      base_amount: "3000",
      status: "SETTLED",
    }))).success, true);

    const afterWithdrawal = await fundDb.getFundCashAsOf("2026-08-04");
    assert.equal(afterWithdrawal.expectedBalance, 45000, "expected rises by the withdrawal");
  });

  await check("platform transactions reject future dates and locked periods", async () => {
    const created = await trading.addPlatform(formData({ name: "Guarded Broker", default_currency: "MYR" }));
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${created.id} LIMIT 1`);
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

    assert.match((await trading.addPlatformTransaction(formData({
      platform_id: created.id,
      account_id: account.id,
      date: future,
      type: "BROKER_DEPOSIT",
      amount: "100",
      currency: "MYR",
      base_amount: "100",
      status: "SETTLED",
    }))).error, /cannot be in the future/i);

    const locked = await one(await sql`
      SELECT TO_CHAR(week_ending, 'YYYY-MM-DD') as week_ending
      FROM nav_weeks WHERE status = 'locked' ORDER BY week_ending DESC LIMIT 1
    `);
    assert.match((await trading.addPlatformTransaction(formData({
      platform_id: created.id,
      account_id: account.id,
      date: locked.week_ending,
      type: "BROKER_DEPOSIT",
      amount: "100",
      currency: "MYR",
      base_amount: "100",
      status: "SETTLED",
    }))).error, /is locked and already priced/i);
  });

  await check("adjustments are rejected because they change no balance", async () => {
    const created = await trading.addPlatform(formData({ name: "Typed Broker", default_currency: "MYR" }));
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${created.id} LIMIT 1`);
    for (const type of ["ADJUSTMENT"]) {
      assert.match((await trading.addPlatformTransaction(formData({
        platform_id: created.id,
        account_id: account.id,
        date: "2026-08-05",
        type,
        amount: "100",
        currency: "MYR",
        base_amount: "100",
        status: "SETTLED",
      }))).error, /Adjustments are no longer recorded/i, `${type} must be rejected`);
    }
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
    assert.deepEqual(legacy.tables.fund_cash_valuations, []);

    // v3 predates fund cash only.
    const v3Order = backupTables.BACKUP_TABLE_ORDER_BY_VERSION[3];
    const v3RowCounts = Object.fromEntries(v3Order.map((table) => [table, table === "investors" ? 1 : 0]));
    const v3Tables = Object.fromEntries(v3Order.map((table) => [table, []]));
    v3Tables.investors = [{ id: crypto.randomUUID(), name: "Legacy V3 Investor", created_at: exportedAt }];
    const legacyV3 = backupValidation.parseBackupJson(JSON.stringify({
      metadata: {
        app: backupTables.BACKUP_APP_NAME,
        schemaVersion: 3,
        exportedAt,
        baseCurrency: backupTables.BACKUP_BASE_CURRENCY,
        tableOrder: v3Order,
        rowCounts: v3RowCounts,
      },
      tables: v3Tables,
    }));
    assert.equal(backupValidation.createBackupPreview(legacyV3).totalRows, 1);
    assert.deepEqual(legacyV3.tables.fund_cash_valuations, []);

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

  await check("an unlocked NAV draft does not price a later NAV", async () => {
    const created = await trading.addPlatform(formData({ name: "Rollback Broker", default_currency: "MYR" }));
    assert.equal(created.success, true);
    const platformId = created.id;
    const account = await one(await sql`SELECT id FROM platform_accounts WHERE platform_id = ${platformId} LIMIT 1`);
    assert.equal((await trading.addPlatformTransaction(formData({
      platform_id: platformId,
      account_id: account.id,
      date: "2026-08-18",
      type: "BROKER_DEPOSIT",
      amount: "10000",
      currency: "MYR",
      base_amount: "10000",
      status: "SETTLED",
    }))).success, true);

    // A fat-fingered override: an order of magnitude above what was deposited.
    await fundDb.createNavWeek({
      weekEnding: "2026-08-22",
      platformSnapshots: [{ platformId, totalValue: 99000 }],
      adjustments: 0,
      notes: "rollback test",
    });

    const mark = await one(await sql`
      SELECT total_value FROM platform_valuations
      WHERE platform_id = ${platformId} AND as_of_date = '2026-08-22' AND audit_status = 'active'
    `);
    assert.equal(mark, undefined, "a draft must not write a value mark");

    // The bug this guards: a draft nobody locked used to price every NAV after it.
    const later = await fundDb.buildNavPlatformPreview("2026-08-23");
    const row = later.find((item) => item.platformId === platformId);
    assert.equal(money(row.totalValue), 10000, "an unlocked draft must not price a later NAV");
    assert.equal(row.source, "NET_INVESTED_FALLBACK");

    // ...but the draft itself must still remember what was typed, or reopening
    // the review screen would silently recompute the week without it.
    const resumed = await fundDb.getDraftNavOverrides("2026-08-22");
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].platformId, platformId);
    assert.equal(money(resumed[0].totalValue), 99000);
  });

  await check("locking a NAV turns its overrides into value marks", async () => {
    const platform = await one(await sql`SELECT id FROM platforms WHERE name = 'Rollback Broker'`);
    const draft = await one(await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-08-22'`);
    await fundDb.lockNavWeek(draft.id);

    const mark = await one(await sql`
      SELECT total_value, source, audit_status FROM platform_valuations
      WHERE platform_id = ${platform.id} AND as_of_date = '2026-08-22'
    `);
    assert.equal(money(mark.total_value), 99000, "locking must record what the override entered");
    assert.equal(mark.source, "NAV_REVIEW");
    assert.equal(mark.audit_status, "active");

    // Only now may it reach a later NAV.
    const later = await fundDb.buildNavPlatformPreview("2026-08-23");
    const row = later.find((item) => item.platformId === platform.id);
    assert.equal(money(row.totalValue), 99000);
    assert.equal(row.source, "CARRIED_FORWARD");

    const audit = await one(await sql`
      SELECT details FROM audit_events WHERE action = 'platform_valuation.record' ORDER BY created_at DESC LIMIT 1
    `);
    const details = typeof audit.details === "string" ? JSON.parse(audit.details) : audit.details;
    assert.equal(details.source, "NAV_REVIEW", "a value entered on the NAV screen must be auditable");
  });

  await check("deleting a draft still voids NAV_REVIEW marks left by older code", async () => {
    const platform = await one(await sql`SELECT id FROM platforms WHERE name = 'Rollback Broker'`);
    await fundDb.createNavWeek({
      weekEnding: "2026-08-23",
      platformSnapshots: [],
      adjustments: 0,
      notes: "legacy repair test",
    });
    // Written straight to the table on purpose: this is the shape a database
    // carries from before drafts stopped writing marks, which no current code
    // path can produce.
    await sql`
      INSERT INTO platform_valuations (platform_id, as_of_date, total_value, source, notes)
      VALUES (${platform.id}, '2026-08-23', 123456, 'NAV_REVIEW', 'legacy draft mark')
      ON CONFLICT (platform_id, as_of_date) DO UPDATE SET
        total_value = EXCLUDED.total_value, source = EXCLUDED.source, audit_status = 'active'
    `;

    const draft = await one(await sql`SELECT id FROM nav_weeks WHERE week_ending = '2026-08-23'`);
    await fundDb.deleteDraftNavWeek(draft.id);

    const after = await one(await sql`
      SELECT audit_status FROM platform_valuations
      WHERE platform_id = ${platform.id} AND as_of_date = '2026-08-23'
    `);
    assert.equal(after.audit_status, "voided", "deleting the draft must take the stale mark back out");

    const audit = await one(await sql`
      SELECT details FROM audit_events WHERE action = 'nav_week.delete_draft' ORDER BY created_at DESC LIMIT 1
    `);
    const details = typeof audit.details === "string" ? JSON.parse(audit.details) : audit.details;
    assert.equal(details.voidedValuations.length, 1, "the log must show what the delete took back");
    assert.equal(details.voidedValuations[0].totalValue, 123456);
  });

  const ok = report("feature tests");
  await sql.end?.();
  if (!ok) process.exitCode = 1;
})().catch(async (error) => {
  console.error(error?.stack || error);
  await sql.end?.();
  process.exit(1);
});
