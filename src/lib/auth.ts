import "server-only";

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_COOKIE = "fund_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type AdminSession = {
  role: "admin";
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

export function validateAdminCredentials(loginId: string, password: string) {
  return sameValue(loginId, requiredEnv("ADMIN_LOGIN_ID")) && verifyAdminPassword(password);
}

export async function createAdminSession() {
  const session: AdminSession = {
    role: "admin",
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
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
