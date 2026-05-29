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

type AdminSession = {
  role: "admin";
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

function sameValue(submitted: string, expected: string) {
  const submittedBytes = Buffer.from(submitted);
  const expectedBytes = Buffer.from(expected);
  return submittedBytes.length === expectedBytes.length && timingSafeEqual(submittedBytes, expectedBytes);
}

function sign(payload: string) {
  return createHmac("sha256", requiredEnv("AUTH_SESSION_SECRET")).update(payload).digest("base64url");
}

export function verifyAdminPassword(password: string) {
  const [scheme, salt, expected] = requiredEnv("ADMIN_PASSWORD_HASH").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const actualBytes = scryptSync(password, Buffer.from(salt, "base64url"), 64);
  const expectedBytes = Buffer.from(expected, "base64url");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function assertAdminPassword(password: string | null | undefined) {
  if (!password || !verifyAdminPassword(password)) {
    throw new Error("Admin password is invalid.");
  }
}

export function validateAdminCredentials(loginId: string, password: string) {
  return sameValue(loginId, requiredEnv("ADMIN_LOGIN_ID")) && verifyAdminPassword(password);
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

export async function createAdminSession() {
  const now = Math.floor(Date.now() / 1000);
  const session: AdminSession = {
    role: "admin",
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

export async function isAdminSessionValid() {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!raw) return false;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !sameValue(signature, sign(payload))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as AdminSession;
    return session.role === "admin" && session.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function requireAdmin() {
  if (!(await isAdminSessionValid())) {
    redirect("/admin/login");
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
