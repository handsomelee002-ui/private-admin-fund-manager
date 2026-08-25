/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  createRunner,
  formData,
  installTsRuntime,
  loadDotEnv,
} = require("./test-runtime.cjs");

const cwd = process.cwd();
const TEST_PORT = Number(process.env.E2E_PORT || 3010);
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9223);
const ADMIN_LOGIN_ID = "codex-admin";
const ADMIN_PASSWORD = "CodexUiTest!2026";
const ADMIN_PASSWORD_HASH = "scrypt$CRX28HWCmWECBoF3IQOzTw$WrSNm6Dg5GFvBkbs7D-JGSia3ExNMVdS4Ou6E1-zKurwJYlYoFsKCEW6R0sRqbLEYiULOQRMMLSrIo2K1-g-1A";
const AUTH_SESSION_SECRET = "codex-ui-test-session-secret-2026";

loadDotEnv();
installTsRuntime({ mockAuth: true });

const { sql } = require("@vercel/postgres");
const fundDb = require("../src/lib/fundDb.ts");
const claims = require("../src/actions/profitClaims.ts");

const { check, report } = createRunner();

function adminCookie() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    role: "admin",
    sid: crypto.randomBytes(18).toString("base64url"),
    issuedAt: now,
    expiresAt: now + 1800,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function edgePath() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("No Chromium browser executable found for E2E tests.");
  return found;
}

async function waitForHttp(url, timeoutMs = 45000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function startDevServer() {
  const logDir = path.join(cwd, "scratch");
  fs.mkdirSync(logDir, { recursive: true });
  const output = fs.openSync(path.join(logDir, "browser-e2e-next.log"), "w");
  const child = spawn(process.execPath, [path.join(cwd, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(TEST_PORT)], {
    cwd,
    env: {
      ...process.env,
      ADMIN_LOGIN_ID,
      ADMIN_PASSWORD_HASH,
      AUTH_SESSION_SECRET,
    },
    stdio: ["ignore", output, output],
    windowsHide: true,
  });
  await waitForHttp(`http://localhost:${TEST_PORT}/admin/login`);
  return child;
}

/**
 * Edge re-spawns itself into a detached process tree and its launcher exits
 * immediately, so child.kill() reaps nothing: the real browser keeps the
 * profile directory and the debugging port. A later run then attaches to that
 * stale, already-logged-in browser and fails in ways that look like
 * application bugs. Ask the browser to close itself over CDP instead.
 */
async function closeBrowser(child) {
  try {
    const version = await httpJson(`http://localhost:${CDP_PORT}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    ws.close();
  } catch {
    // Browser already gone, or never came up.
  }
  try {
    child?.kill();
  } catch {
    // Already gone.
  }
  // Do not return while the debugging port is still bound, or the next run
  // attaches to this browser instead of its own.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await httpJson(`http://localhost:${CDP_PORT}/json/version`);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function startBrowser() {
  // A browser from a previous run can still hold the profile on Windows, and
  // force:true does not cover EBUSY. Fall back to a fresh directory rather than
  // failing the whole suite on a stale lock.
  let userDataDir = path.join(cwd, "scratch", "browser-e2e-profile");
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    userDataDir = path.join(cwd, "scratch", `browser-e2e-profile-${process.pid}-${Date.now()}`);
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  // A browser left behind by an earlier run still owns the debugging port and
  // its session cookies. Attaching to it silently would make authentication
  // tests pass or fail for reasons unrelated to the code under test.
  let stale = null;
  try {
    stale = await httpJson(`http://localhost:${CDP_PORT}/json/version`);
  } catch {
    stale = null;
  }
  if (stale) {
    await closeBrowser(null);
    throw new Error(
      `Port ${CDP_PORT} is already serving a Chrome DevTools endpoint. Close the leftover browser and re-run.`,
    );
  }
  const child = spawn(edgePath(), [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  await waitForHttp(`http://localhost:${CDP_PORT}/json/version`);
  return child;
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${options.method || "GET"} ${url} failed: ${response.status}`);
  return response.json();
}

async function openCdpPage(url) {
  const target = await httpJson(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(JSON.stringify(message.error)));
      else callbacks.resolve(message.result);
    }
  };
  async function send(method, params = {}) {
    const messageId = ++id;
    ws.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
  }
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  return { send, close: () => ws.close() };
}

async function evalJs(page, expression) {
  const result = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function waitFor(page, expression, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evalJs(page, `(() => { try { return Boolean(${expression}); } catch { return false; } })()`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const body = await evalJs(page, "document.body ? document.body.innerText.slice(0, 800) : ''").catch(() => "");
  throw new Error(`Timed out waiting for: ${expression}\nBody: ${body}`);
}

async function navigate(page, url) {
  await page.send("Page.navigate", { url });
  await waitFor(page, 'document.readyState === "complete" || document.readyState === "interactive"');
}

async function setValue(page, selector, value) {
  await evalJs(page, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing selector ${selector}");
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return element.value;
  })()`);
}

async function clickText(page, text) {
  await evalJs(page, `(() => {
    const wanted = ${JSON.stringify(text)};
    const nodes = [...document.querySelectorAll('button,[role="button"],a')];
    const element = nodes.find((node) => node.textContent.trim() === wanted) ||
      nodes.find((node) => node.textContent.includes(wanted));
    if (!element) throw new Error("Missing clickable text " + wanted);
    element.click();
    return true;
  })()`);
}

async function clickTriggerMouse(page, text) {
  const box = await evalJs(page, `(() => {
    const wanted = ${JSON.stringify(text)};
    const nodes = [...document.querySelectorAll('[data-slot="dialog-trigger"],button,[role="button"]')];
    const element = nodes.find((node) => node.textContent.includes(wanted));
    if (!element) throw new Error("Missing trigger " + wanted);
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
}

async function bodyIncludes(page, text) {
  return evalJs(page, `document.body.innerText.includes(${JSON.stringify(text)})`);
}

async function setViewport(page, width, height) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
}

async function noHorizontalOverflow(page) {
  return evalJs(page, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2");
}

(async () => {
  await fundDb.seedDummyData();
  const alice = await sql`SELECT id FROM investors WHERE name = 'Alice Tan'`;
  await claims.addProfitClaim(formData({
    investor_id: alice.rows[0].id,
    locked_amount: "1000",
    claim_date: "2026-06-01",
    notes: "e2e claim",
  }));

  const devServer = await startDevServer();
  const browserProcess = await startBrowser();
  const page = await openCdpPage("about:blank");
  const unique = Date.now();
  const investorName = `UI Investor ${unique}`;
  const platformName = `UI Platform ${unique}`;

  try {
    await check("unauthenticated protected route redirects to admin login", async () => {
      await navigate(page, `http://localhost:${TEST_PORT}/investors`);
      await waitFor(page, 'location.pathname === "/admin/login"');
    });

    await check("login form rejects invalid credentials with visible alert semantics", async () => {
      await setValue(page, "input[name=loginId]", "wrong-admin");
      await setValue(page, "input[name=password]", "wrong-password");
      await clickText(page, "Sign in");
      await waitFor(page, 'document.body.innerText.includes("Invalid administrator credentials") || document.body.innerText.includes("Too many failed")');
      assert.equal(await evalJs(page, 'document.querySelector("[role=alert]") !== null'), true);
    });

    await page.send("Network.setCookie", {
      name: "fund_admin_session",
      value: adminCookie(),
      url: `http://localhost:${TEST_PORT}/`,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });

    await check("add investor form submits and duplicate path alerts", async () => {
      await navigate(page, `http://localhost:${TEST_PORT}/investors`);
      await waitFor(page, 'document.body.innerText.includes("Add Investor")');
      await clickTriggerMouse(page, "Add Investor");
      await waitFor(page, 'document.querySelector("input[name=name]")');
      await setValue(page, "input[name=name]", investorName);
      await clickText(page, "Save Investor");
      await waitFor(page, `document.body.innerText.includes(${JSON.stringify(investorName)})`);
      assert.equal((await sql`SELECT COUNT(*)::int count FROM investors WHERE name = ${investorName}`).rows[0].count, 1);

      await evalJs(page, "window.__alerts = []; window.alert = (message) => window.__alerts.push(String(message)); true");
      await clickTriggerMouse(page, "Add Investor");
      await waitFor(page, 'document.querySelector("input[name=name]")');
      await setValue(page, "input[name=name]", "Alice Tan");
      await clickText(page, "Save Investor");
      await waitFor(page, "window.__alerts.length > 0");
      assert.match((await evalJs(page, "window.__alerts.join('\\n')")), /already exists/i);
    });

    await check("high-value workflow forms open with expected labels and actions", async () => {
      const expectations = [
        { url: "/capital", trigger: "Cash Movement", text: "Record Deposit or Withdrawal", opensDialog: true },
        { url: "/fixed-savings", trigger: "Fixed Savings", text: "Record Fixed Savings", opensDialog: true },
        { url: "/nav", trigger: "New NAV", text: "Review & create NAV", opensDialog: true },
        { url: "/claims", trigger: "Settle", text: "Settle Profit Claim", opensDialog: true, jsClick: true },
        { url: "/admin-logs", trigger: "Revert", text: "Revert", opensDialog: false },
      ];
      for (const item of expectations) {
        await navigate(page, `http://localhost:${TEST_PORT}${item.url}`);
        await waitFor(page, `document.body.innerText.includes(${JSON.stringify(item.trigger)})`);
        if (item.opensDialog && item.jsClick) await clickText(page, item.trigger);
        else if (item.opensDialog) await clickTriggerMouse(page, item.trigger);
        await waitFor(page, `document.body.innerText.includes(${JSON.stringify(item.text)})`);
      }
    });

    await check("tall dialogs fit the viewport and scroll internally", async () => {
      // The NAV review dialog grows with the platform count. It must cap at the
      // viewport and scroll its own body, never push the page taller than the
      // screen and strand the Save button off-screen.
      for (const [width, height] of [[1280, 720], [1366, 900], [768, 1024]]) {
        await setViewport(page, width, height);
        await navigate(page, `http://localhost:${TEST_PORT}/nav`);
        await waitFor(page, 'document.body.innerText.includes("New NAV")');
        await clickTriggerMouse(page, "New NAV");
        await waitFor(page, 'document.body.innerText.includes("Review & create NAV")');
        await waitFor(page, '!document.body.innerText.includes("Loading platform values")');

        const metrics = await evalJs(page, `(() => {
          const dialog = document.querySelector("[data-slot=dialog-content]");
          const rect = dialog.getBoundingClientRect();
          const scroller = [...dialog.querySelectorAll("*")]
            .find((node) => getComputedStyle(node).overflowY === "auto" && node.scrollHeight > 0);
          const save = [...dialog.querySelectorAll("button")]
            .find((node) => node.textContent.includes("Save draft"));
          const saveRect = save.getBoundingClientRect();
          return {
            dialogHeight: Math.round(rect.height),
            viewport: window.innerHeight,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            hasScroller: Boolean(scroller),
            saveVisible: saveRect.bottom <= window.innerHeight + 1 && saveRect.top >= -1,
          };
        })()`);

        assert.equal(
          metrics.dialogHeight <= metrics.viewport,
          true,
          `NAV dialog is ${metrics.dialogHeight}px tall in a ${metrics.viewport}px viewport at ${width}x${height}`,
        );
        assert.equal(metrics.top >= 0, true, `NAV dialog top is cut off at ${width}x${height}`);
        assert.equal(
          metrics.bottom <= metrics.viewport,
          true,
          `NAV dialog bottom is cut off at ${width}x${height}`,
        );
        assert.equal(metrics.hasScroller, true, `NAV dialog has no internal scroll region at ${width}x${height}`);
        assert.equal(metrics.saveVisible, true, `Save draft is off-screen at ${width}x${height}`);

        await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await waitFor(page, '!document.querySelector("[data-slot=dialog-content]")');
      }
      await setViewport(page, 1280, 720);
    });

    await check("reopening a saved NAV draft restores the values that were typed", async () => {
      // A draft's overrides are no longer value marks, so nothing re-derives
      // them when the dialog reopens. If the form does not restore them, the
      // Override column comes back empty and the next Save draft silently
      // recomputes the week without them.
      await setViewport(page, 1280, 900);
      await navigate(page, `http://localhost:${TEST_PORT}/nav`);
      await waitFor(page, 'document.body.innerText.includes("New NAV")');
      await clickTriggerMouse(page, "New NAV");
      await waitFor(page, '!document.body.innerText.includes("Loading platform values")');

      const firstOverride = await evalJs(page, `(() => {
        const input = document.querySelector("[data-slot=dialog-content] input[name^=platform_value_]");
        return input ? input.name : null;
      })()`);
      assert.ok(firstOverride, "the review screen must offer an override input");

      await setValue(page, `input[name=${firstOverride}]`, "4242.42");
      await waitFor(page, '!document.body.innerText.includes("updating")');
      await clickText(page, "Save draft");
      await waitFor(page, '!document.body.innerText.includes("Review & create NAV")');

      // Reopen for the same date and the typed figure must still be there.
      await clickTriggerMouse(page, "New NAV");
      await waitFor(page, '!document.body.innerText.includes("Loading platform values")');
      await waitFor(page, `(() => {
        const input = document.querySelector("input[name=${firstOverride}]");
        return Boolean(input && Number(input.value) === 4242.42);
      })()`);
      const restored = await evalJs(page, `document.querySelector("input[name=${firstOverride}]").value`);
      assert.equal(Number(restored), 4242.42, "the draft's override must be restored");
    });

    await check("add trading platform form submits and detail transaction form opens", async () => {
      await navigate(page, `http://localhost:${TEST_PORT}/trading`);
      await waitFor(page, 'document.body.innerText.includes("Add Platform")');
      await clickTriggerMouse(page, "Add Platform");
      await waitFor(page, 'document.querySelector("input[name=name]") && document.querySelector("input[name=default_currency]")');
      await setValue(page, "input[name=name]", platformName);
      await setValue(page, "input[name=default_currency]", "USD");
      await clickText(page, "Save Platform");
      await waitFor(page, 'location.pathname.startsWith("/trading/")');
      await waitFor(page, 'document.body.innerText.includes("Add Transaction")');
      assert.equal((await sql`SELECT COUNT(*)::int count FROM platforms WHERE name = ${platformName}`).rows[0].count, 1);
    });

    await check("funding dialog offers only live sources and brokerage splits realised from unrealised", async () => {
      // The platform created by the previous test is still the current page.
      await waitFor(page, 'document.body.innerText.includes("Add Transaction")');
      await clickTriggerMouse(page, "Add Transaction");
      await waitFor(page, 'document.querySelector("input[name=base_amount]")');
      await waitFor(page, 'document.body.innerText.includes("Allocation Preview")');

      const allocationPanel = await evalJs(page, `(() => {
        const heading = [...document.querySelectorAll("p")].find((node) => node.innerText === "Allocation Preview");
        return heading ? heading.closest("div.space-y-3").innerText : null;
      })()`);
      assert.equal(allocationPanel !== null, true, "allocation preview not found");
      assert.equal(
        /Brokerage/.test(allocationPanel),
        false,
        `funding dialog still offers brokerage: ${allocationPanel}`,
      );
      assert.equal(/Equity/.test(allocationPanel) && /Fixed Savings/.test(allocationPanel), true);

      await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 27, key: "Escape" });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 27, key: "Escape" });

      // The pot is presented as two capital accounts. Only the realised one may
      // be withdrawn, so both columns have to be on screen for the cap to make
      // sense to whoever is reading it.
      await navigate(page, `http://localhost:${TEST_PORT}/brokerage`);
      await waitFor(page, 'document.body.innerText.includes("Interest Credited")');
      assert.equal(await bodyIncludes(page, "Brokerage Account Balance"), true);
      assert.equal(await bodyIncludes(page, "Realised"), true);
      assert.equal(await bodyIncludes(page, "Unrealised"), true);
      assert.equal(await bodyIncludes(page, "Non-Equity Investment P&L"), true);

      // The offset module is gone: no second draw on the pot, and no interest
      // discharged out of profit.
      assert.equal(await bodyIncludes(page, "Offset Interest"), false, "the offset action should be gone");
      assert.equal(await bodyIncludes(page, "Interest Offset"), false, "the offset tile should be gone");
      assert.equal(await bodyIncludes(page, "earned back"), false, "the coverage split should be gone");
    });

    await check("settings backup UI exposes export, validate, and restore controls after password gate", async () => {
      await navigate(page, `http://localhost:${TEST_PORT}/settings`);
      await waitFor(page, 'document.body.innerText.includes("Manual Database Backup")');
      await setValue(page, "#settings_admin_password", ADMIN_PASSWORD);
      assert.equal(await bodyIncludes(page, "Export JSON"), true);
      assert.equal(await bodyIncludes(page, "Validate Backup"), true);
    });

    await check("public portal renders investor statement from portal access id", async () => {
      const portalId = `ui_portal_${unique}`;
      await sql`UPDATE investors SET portal_access_id = ${portalId}, portal_access_rotated_at = NOW() WHERE name = ${investorName}`;
      await navigate(page, `http://localhost:${TEST_PORT}/portal/${portalId}`);
      await waitFor(page, `document.body.innerText.includes(${JSON.stringify(investorName)})`);
      assert.equal(await bodyIncludes(page, "Activity Ledger"), true);
    });

    // The portal and the admin statement read the same getInvestorStatement, so
    // any difference here is a rendering gap rather than a data one - which is
    // exactly how the equity P&L line went missing from the portal.
    await check("portal shows the same equity P&L figure as the admin statement", async () => {
      // Must be an investor with a real position. The investor this suite
      // creates holds no units, so both pages would render "RM 0.00 | -" and
      // match each other while proving nothing.
      const holder = await sql`
        SELECT investor_id, SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END) as units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
        GROUP BY investor_id
        HAVING SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END) > 0
        ORDER BY units DESC
        LIMIT 1
      `;
      assert.equal(holder.rows.length, 1, "no investor holds units, cannot compare statements");
      const investorId = holder.rows[0].investor_id;
      const portalId = `ui_portal_parity_${unique}`;
      await sql`UPDATE investors SET portal_access_id = ${portalId}, portal_access_rotated_at = NOW() WHERE id = ${investorId}`;

      const pnlSelector = 'document.querySelector(\'[title^="Equity P&L equals"]\')?.innerText?.trim() ?? null';

      await navigate(page, `http://localhost:${TEST_PORT}/investors/${investorId}`);
      await waitFor(page, `${pnlSelector} !== null`);
      const adminPnl = await evalJs(page, pnlSelector);

      await navigate(page, `http://localhost:${TEST_PORT}/portal/${portalId}`);
      await waitFor(page, `${pnlSelector} !== null`);
      const portalPnl = await evalJs(page, pnlSelector);

      // Guard against both sides rendering a placeholder and "matching".
      assert.match(adminPnl, /^[+-]?RM [\d,]+\.\d\d \| [+-]?[\d,.]+%$/, `admin statement P&L line looks wrong: ${adminPnl}`);
      assert.equal(portalPnl, adminPnl);
    });

    await check("dashboard metric cards print their whole breakdown without interaction", async () => {
      await setViewport(page, 1366, 900);
      await navigate(page, `http://localhost:${TEST_PORT}/`);
      await waitFor(page, 'document.body.innerText.includes("Equity NAV")');

      const cards = await evalJs(page, `(() => {
        const wanted = ["Equity NAV", "Fixed Savings Net Principal", "Investor Capital", "Available Cash"];
        const out = {};
        for (const title of wanted) {
          const heading = [...document.querySelectorAll("[data-slot=card-title]")]
            .find((node) => node.textContent.trim() === title);
          out[title] = heading ? heading.closest("[data-slot=card]").innerText : null;
        }
        return JSON.stringify(out);
      })()`);
      const byTitle = JSON.parse(cards);
      for (const [title, text] of Object.entries(byTitle)) {
        assert.equal(text !== null, true, `metric card missing: ${title}`);
      }

      // The point of the redesign: no figure is behind a hover. Each card's
      // rows have to be in the DOM on load.
      assert.match(byTitle["Equity NAV"], /Invested capital/);
      assert.match(byTitle["Equity NAV"], /NAV \/ unit/);
      assert.match(byTitle["Equity NAV"], /Total units/);
      // Principal is the headline; the rows reconcile it to the full liability
      // so the two figures are never mistaken for each other.
      assert.match(byTitle["Fixed Savings Net Principal"], /Accrued interest/);
      assert.match(byTitle["Fixed Savings Net Principal"], /Bonuses payable/);
      assert.match(byTitle["Fixed Savings Net Principal"], /Total liability/);
      assert.match(byTitle["Investor Capital"], /Fixed savings liability/);
      assert.match(byTitle["Available Cash"], /Deployed in platforms/);
      assert.match(byTitle["Available Cash"], /Bank total/);
      assert.equal(
        /Equity/.test(byTitle["Available Cash"]) && /Fixed Savings/.test(byTitle["Available Cash"]),
        true,
      );
      // The pot cannot fund a platform, so it has no line on a card about
      // what the fund can still deploy.
      assert.equal(
        /Brokerage/i.test(byTitle["Available Cash"]),
        false,
        `brokerage is back on the card: ${byTitle["Available Cash"]}`,
      );

      // Available Cash is the only card with more to say than fits on it.
      const popovers = await evalJs(page, `
        [...document.querySelectorAll("[data-slot=popover-trigger]")].length
      `);
      assert.equal(popovers, 1, `expected 1 popover trigger on the dashboard, found ${popovers}`);

      // Hover is the primary affordance, so it has to actually open the panel.
      const box = await evalJs(page, `(() => {
        const rect = document.querySelector("[data-slot=popover-trigger]").getBoundingClientRect();
        return JSON.stringify({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
      })()`);
      const point = JSON.parse(box);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons: 0 });
      await waitFor(page, 'document.querySelector("[data-slot=popover-content]")');
      const panel = await evalJs(page, 'document.querySelector("[data-slot=popover-content]").innerText');
      assert.match(panel, /Owned/);
      assert.match(panel, /Bank reconciliation/i);
      // The reconciliation has to name the pot: it is the reason the bank total
      // is larger than what the two fundable pools can deploy.
      assert.match(panel, /Brokerage pot, undeployed/);

      // Hover alone is unreachable on touch, so clicking must work too.
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, buttons: 0 });
      await waitFor(page, '!document.querySelector("[data-slot=popover-content]")');
      await clickTriggerMouse(page, "Available Cash");
      await waitFor(page, 'document.querySelector("[data-slot=popover-content]")');
    });

    await check("investor dashboard renders, links both ways, and leaks no platform values", async () => {
      const holder = await sql`
        SELECT investor_id, SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END) as units
        FROM investor_unit_ledger
        WHERE audit_status = 'active'
        GROUP BY investor_id
        HAVING SUM(CASE WHEN type = 'UnitIssue' THEN units ELSE -units END) > 0
        ORDER BY units DESC
        LIMIT 1
      `;
      assert.equal(holder.rows.length, 1, "no investor holds units");
      const portalId = `ui_portal_dash_${unique}`;
      await sql`UPDATE investors SET portal_access_id = ${portalId}, portal_access_rotated_at = NOW() WHERE id = ${holder.rows[0].investor_id}`;

      // Activity page -> dashboard.
      await navigate(page, `http://localhost:${TEST_PORT}/portal/${portalId}`);
      await waitFor(page, 'document.body.innerText.includes("Dashboard")');
      await clickText(page, "Dashboard");
      await waitFor(page, 'location.pathname.endsWith("/dashboard")');
      await waitFor(page, 'document.body.innerText.includes("Where the Fund Is Invested")');
      assert.equal(await bodyIncludes(page, "Your Value Over Time"), true);
      assert.equal(await bodyIncludes(page, "Fund NAV per Unit"), true);

      // The platform names the investor is told about must actually be the
      // fund's platforms, each shown as a percentage.
      const platforms = await sql`
        WITH latest_nav AS (SELECT id FROM nav_weeks WHERE status = 'locked' ORDER BY week_ending DESC LIMIT 1)
        SELECT p.name, nwps.total_value::float AS total_value
        FROM nav_week_platform_snapshots nwps
        JOIN platforms p ON p.id = nwps.platform_id
        WHERE nwps.nav_week_id = (SELECT id FROM latest_nav) AND nwps.total_value > 0
      `;
      assert.equal(platforms.rows.length > 0, true, "no platforms in the latest locked NAV");
      for (const platform of platforms.rows) {
        assert.equal(await bodyIncludes(page, platform.name), true, `dashboard omits platform ${platform.name}`);
      }

      // Hiding an RM figure in the markup is not enough - a server component
      // ships its props to the browser, so the value would still be readable in
      // the page payload. Assert against the whole document, not the text.
      const html = await evalJs(page, "document.documentElement.outerHTML");
      for (const platform of platforms.rows) {
        const value = Number(platform.total_value);
        for (const rendering of [value.toFixed(2), value.toFixed(0), String(value)]) {
          assert.equal(
            html.includes(rendering),
            false,
            `portal dashboard leaks platform value ${rendering} for ${platform.name}`,
          );
        }
      }

      // Dashboard -> activity page.
      await clickText(page, "Activity Ledger");
      await waitFor(page, 'document.body.innerText.includes("Activity Ledger")');
      await waitFor(page, '!location.pathname.endsWith("/dashboard")');
    });

    await check("tablet and mobile smoke tests avoid horizontal overflow on dense admin pages", async () => {
      for (const [width, height] of [[768, 1024], [390, 844]]) {
        await setViewport(page, width, height);
        for (const route of ["/", "/investors", "/capital", "/fixed-savings", "/claims", "/nav", "/trading"]) {
          await navigate(page, `http://localhost:${TEST_PORT}${route}`);
          await waitFor(page, "document.body.innerText.length > 0");
          assert.equal(await noHorizontalOverflow(page), true, `${route} overflows at ${width}px`);
        }
      }
    });

    await check("accessibility smoke verifies labels, dialog focus, keyboard escape, and no console errors", async () => {
      await setViewport(page, 1366, 900);
      await navigate(page, `http://localhost:${TEST_PORT}/investors`);
      await clickTriggerMouse(page, "Add Investor");
      await waitFor(page, 'document.querySelector("[data-slot=dialog-content]")');
      assert.equal(await evalJs(page, 'document.activeElement && document.querySelector("[data-slot=dialog-content]")?.contains(document.activeElement)'), true);
      assert.equal(await evalJs(page, `
        [...document.querySelectorAll('input:not([type="hidden"])')]
          .filter((input) => input.offsetParent !== null)
          .every((input) => input.id || input.getAttribute('aria-label') || input.closest('label'))
      `), true);
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await waitFor(page, 'document.querySelector("[data-slot=dialog-content]") === null');
      const logs = await page.send("Runtime.evaluate", {
        expression: "performance.getEntriesByType('resource').length >= 0",
        returnByValue: true,
      });
      assert.equal(logs.result.value, true);
    });
  } finally {
    page.close();
    await closeBrowser(browserProcess);
    devServer.kill();
  }

  const ok = report("browser E2E tests");
  await sql.end?.();
  if (!ok) process.exitCode = 1;
})().catch(async (error) => {
  console.error(error?.stack || error);
  await sql.end?.();
  process.exit(1);
});
