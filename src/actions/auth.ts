"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clearAdminSession,
  createAdminSession,
  validateAdminCredentials,
} from "@/lib/auth";

export type LoginState = {
  error?: string;
};

const loginSchema = z.object({
  loginId: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function loginAdmin(_: LoginState, formData: FormData): Promise<LoginState> {
  const result = loginSchema.safeParse({
    loginId: formData.get("loginId"),
    password: formData.get("password"),
  });

  if (!result.success || !validateAdminCredentials(result.data.loginId, result.data.password)) {
    return { error: "Invalid administrator credentials." };
  }

  await createAdminSession();
  redirect("/");
}

export async function logoutAdmin() {
  await clearAdminSession();
  redirect("/admin/login");
}
