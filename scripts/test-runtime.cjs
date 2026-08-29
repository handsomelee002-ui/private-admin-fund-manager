/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function loadDotEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index < 1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function installTsRuntime({
  cwd = process.cwd(),
  mockAuth = false,
  mockCookies = false,
  mockNavigation = true,
} = {}) {
  const originalResolve = Module._resolveFilename;
  const originalLoad = Module._load;

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith("@/")) request = path.join(cwd, "src", request.slice(2));
    return originalResolve.call(this, request, parent, isMain, options);
  };

  Module._load = function loadModule(request, parent, isMain) {
    if (request === "server-only") return {};
    if (request === "next/cache") return { revalidatePath() {} };
    if (request === "next/navigation" && mockNavigation) {
      return {
        redirect(url) {
          const error = new Error(`redirect:${url}`);
          error.url = url;
          throw error;
        },
        notFound() {
          throw new Error("notFound");
        },
      };
    }
    if (request === "next/headers" && mockCookies) {
      return {
        cookies: async () => ({ get: () => undefined, set() {}, delete() {} }),
        headers: async () => new Map(),
      };
    }

    const resolved = Module._resolveFilename(request, parent, isMain);
    if (mockAuth && resolved.endsWith(path.join("src", "lib", "auth.ts"))) {
      return {
        verifyAdminPassword: () => true,
        assertAdminPassword: () => {},
        validateAdminCredentials: () => true,
        authenticate: () => "admin",
        ensureAuthSecurityTables: async () => {},
        isAdminLoginLocked: async () => false,
        recordAdminLoginAttempt: async () => {},
        createSession: async () => {},
        clearAdminSession: async () => {},
        getSession: async () => ({ role: "admin", sid: "test", issuedAt: 0, expiresAt: 4102444800 }),
        isAdminSessionValid: async () => true,
        requireSession: async () => ({ role: "admin" }),
        requireAdmin: async () => ({ id: "admin", role: "admin", name: "Admin" }),
        // Mirrors the real implementation. Server actions call this in every
        // catch block, so omitting it here fails them with "not a function"
        // rather than exercising the behaviour under test.
        isRedirectError: (error) => typeof error?.digest === "string" && error.digest.startsWith("NEXT_REDIRECT"),
        generatePortalAccessId: () => `portal_${cryptoRandom()}`,
        assertDevelopmentDataToolsEnabled: () => {},
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  require.extensions[".ts"] = function compileTypeScript(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

function cryptoRandom() {
  return require("node:crypto").randomUUID().replaceAll("-", "");
}

function formData(entries) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) form.set(key, String(value));
  }
  return form;
}

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function createRunner() {
  const results = [];

  async function check(name, fn) {
    try {
      await fn();
      results.push({ status: "PASS", name });
    } catch (error) {
      results.push({ status: "FAIL", name, error: error?.stack || String(error) });
    }
  }

  function report(label) {
    const failed = results.filter((result) => result.status === "FAIL");
    for (const result of results) {
      console.log(`${result.status}: ${result.name}`);
      if (result.error) console.log(result.error.split("\n").slice(0, 8).join("\n"));
    }
    console.log(`SUMMARY: ${results.length - failed.length}/${results.length} ${label} passed`);
    return failed.length === 0;
  }

  return { check, report, results };
}

module.exports = {
  createRunner,
  formData,
  installTsRuntime,
  loadDotEnv,
  money,
};
