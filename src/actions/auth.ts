"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  authenticate,
  clearAdminSession,
  createSession,
  isAdminLoginLocked,
  recordAdminLoginAttempt,
} from "@/lib/auth";

export type LoginState = {
  error?: string;
};

const loginSchema = z.object({
  loginId: z.string().trim().min(1),
  password: z.string().min(1),
});

async function loginClientKey() {
  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || headerStore.get("x-real-ip") || "unknown";
  const userAgent = headerStore.get("user-agent") || "unknown";
  return createHash("sha256").update(`${ip}|${userAgent}`).digest("base64url");
}

export async function loginAdmin(_: LoginState, formData: FormData): Promise<LoginState> {
  const result = loginSchema.safeParse({
    loginId: formData.get("loginId"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { error: "Invalid administrator credentials." };
  }

  const clientKey = await loginClientKey();
  if (await isAdminLoginLocked(clientKey, result.data.loginId)) {
    return { error: "Too many failed sign-in attempts. Try again later." };
  }

  const role = authenticate(result.data.loginId, result.data.password);
  await recordAdminLoginAttempt(clientKey, result.data.loginId, role !== null);
  if (!role) {
    return { error: "Invalid administrator credentials." };
  }

  await clearAdminSession();
  await createSession(role);
  redirect("/");
}

export async function logoutAdmin() {
  await clearAdminSession();
  redirect("/admin/login");
}
