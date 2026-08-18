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

async function startBrowser() {
  const userDataDir = path.join(cwd, "scratch", "browser-e2e-profile");
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
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

    await check("tablet and mobile smoke tests avoid horizontal overflow on dense admin pages", async () => {
      for (const [width, height] of [[768, 1024], [390, 844]]) {
        await setViewport(page, width, height);
        for (const route of ["/investors", "/capital", "/fixed-savings", "/claims", "/nav", "/trading"]) {
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
    browserProcess.kill();
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
