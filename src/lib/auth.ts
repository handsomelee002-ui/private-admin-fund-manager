import "server-only";

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql } from "@vercel/postgres";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_COOKIE = "fund_admin_session";
const SESSION_TTL_SECONDS = 60 * 30;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const LOGIN_WINDOW_INTERVAL = `${LOGIN_WINDOW_MINUTES} minutes`;
const LOGIN_RETENTION_INTERVAL = `${LOGIN_LOCKOUT_MINUTES * 4} minutes`;

export type SessionRole = "admin" | "viewer";

type Session = {
  role: SessionRole;
  sid: string;
  issuedAt: number;
  expiresAt: number;
};

function requiredEnv(name: "ADMIN_LOGIN_ID" | "ADMIN_PASSWORD_HASH" | "AUTH_SESSION_SECRET") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required authentication configuration: ${name}.`);
  }
  return value;
}

// The read-only viewer account is optional. It exists only when both variables
// are set, so an operator who never configures it keeps a single-account app.
function viewerCredentials() {
  const loginId = process.env.VIEWER_LOGIN_ID;
  const passwordHash = process.env.VIEWER_PASSWORD_HASH;
  if (!loginId || !passwordHash) return null;
  return { loginId, passwordHash };
}

function sameValue(submitted: string, expected: string) {
  const submittedBytes = Buffer.from(submitted);
  const expectedBytes = Buffer.from(expected);
  return submittedBytes.length === expectedBytes.length && timingSafeEqual(submittedBytes, expectedBytes);
}

function sign(payload: string) {
  return createHmac("sha256", requiredEnv("AUTH_SESSION_SECRET")).update(payload).digest("base64url");
}

function verifyPassword(password: string, passwordHash: string) {
  const [scheme, salt, expected] = passwordHash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const actualBytes = scryptSync(password, Buffer.from(salt, "base64url"), 64);
  const expectedBytes = Buffer.from(expected, "base64url");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function verifyAdminPassword(password: string) {
  return verifyPassword(password, requiredEnv("ADMIN_PASSWORD_HASH"));
}

export function assertAdminPassword(password: string | null | undefined) {
  if (!password || !verifyAdminPassword(password)) {
    throw new Error("Admin password is invalid.");
  }
}

export function validateAdminCredentials(loginId: string, password: string) {
  return sameValue(loginId, requiredEnv("ADMIN_LOGIN_ID")) && verifyAdminPassword(password);
}

/**
 * Resolve a login to the role it authenticates as, or null. Admin is checked
 * first so it always wins if the two accounts were ever given the same id.
 */
export function authenticate(loginId: string, password: string): SessionRole | null {
  if (sameValue(loginId, requiredEnv("ADMIN_LOGIN_ID")) && verifyAdminPassword(password)) {
    return "admin";
  }
  const viewer = viewerCredentials();
  if (viewer && sameValue(loginId, viewer.loginId) && verifyPassword(password, viewer.passwordHash)) {
    return "viewer";
  }
  return null;
}

export async function ensureAuthSecurityTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS admin_auth_attempts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      login_id TEXT NOT NULL,
      client_key TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS admin_auth_attempts_client_key_created_at_idx ON admin_auth_attempts (client_key, created_at DESC)`;
}

export async function isAdminLoginLocked(clientKey: string, loginId: string) {
  await ensureAuthSecurityTables();
  const result = await sql`
    SELECT COUNT(*)::int as failures
    FROM admin_auth_attempts
    WHERE client_key = ${clientKey}
      AND success = false
      AND created_at > NOW() - ${LOGIN_WINDOW_INTERVAL}::interval
      AND NOT EXISTS (
        SELECT 1
        FROM admin_auth_attempts successful
        WHERE successful.client_key = ${clientKey}
          AND successful.success = true
          AND successful.created_at > admin_auth_attempts.created_at
      )
  `;
  void loginId;
  return Number(result.rows[0]?.failures || 0) >= LOGIN_MAX_FAILURES;
}

export async function recordAdminLoginAttempt(clientKey: string, loginId: string, success: boolean) {
  await ensureAuthSecurityTables();
  await sql`
    INSERT INTO admin_auth_attempts (login_id, client_key, success)
    VALUES (${loginId}, ${clientKey}, ${success})
  `;
  await sql`
    DELETE FROM admin_auth_attempts
    WHERE created_at < NOW() - ${LOGIN_RETENTION_INTERVAL}::interval
  `;
}

export async function createSession(role: SessionRole) {
  const now = Math.floor(Date.now() / 1000);
  const session: Session = {
    role,
    sid: randomBytes(18).toString("base64url"),
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  (await cookies()).set(ADMIN_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!raw) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !sameValue(signature, sign(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    const roleOk = session.role === "admin" || session.role === "viewer";
    if (roleOk && session.expiresAt > Math.floor(Date.now() / 1000)) return session;
    return null;
  } catch {
    return null;
  }
}

export async function isAdminSessionValid() {
  return (await getSession())?.role === "admin";
}

/**
 * `redirect()` works by throwing, and most server actions wrap their body in a
 * try/catch that returns `{ error }`. That swallowed the redirect and showed a
 * raw "NEXT_REDIRECT" string instead of the login page. Rethrowing it here is
 * not enough - the catch is downstream - so callers use `isRedirectError` to
 * let it through.
 */
export function isRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string"
    && ((error as { digest: string }).digest.startsWith("NEXT_REDIRECT"));
}

/**
 * Any signed-in account (admin or read-only viewer). Use this to guard reads and
 * page loads. An anonymous request is sent to the login screen.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/admin/login");
  }
  return { role: session.role };
}

/**
 * Admin-only. Use this to guard every mutation. An anonymous request is sent to
 * the login screen; a signed-in viewer is refused with an error the calling
 * server action surfaces to the page.
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    redirect("/admin/login");
  }
  if (session.role !== "admin") {
    throw new Error("This action requires an administrator account.");
  }
  return { id: "admin", role: "admin" as const, name: "Admin" };
}

export function generatePortalAccessId() {
  return randomBytes(24).toString("base64url");
}

export function assertDevelopmentDataToolsEnabled() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development data tools are disabled in production.");
  }
}
