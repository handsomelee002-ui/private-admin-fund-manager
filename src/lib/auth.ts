import { cookies } from "next/headers";

export type AppRole = "admin" | "investor";

const DEV_ADMIN = {
  id: "dev-admin",
  role: "admin" as const,
  name: "Development Admin",
};

function isDevelopmentBypassAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_DATA_TOOLS === "true";
}

export async function requireAdmin() {
  if (isDevelopmentBypassAllowed()) return DEV_ADMIN;

  const token = (await cookies()).get("admin_access_token")?.value;
  const expected = process.env.ADMIN_ACCESS_TOKEN;
  if (!expected || token !== expected) {
    throw new Error("Unauthorized admin action.");
  }

  return {
    id: "admin",
    role: "admin" as const,
    name: "Admin",
  };
}

export async function requireInvestorAccess(investorId: string) {
  if (isDevelopmentBypassAllowed()) {
    return { id: investorId, role: "investor" as const };
  }

  const authorizedInvestorId = (await cookies()).get("investor_id")?.value;
  if (!authorizedInvestorId || authorizedInvestorId !== investorId) {
    throw new Error("Unauthorized investor access.");
  }

  return { id: authorizedInvestorId, role: "investor" as const };
}

export function assertDevelopmentDataToolsEnabled() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_DATA_TOOLS !== "true") {
    throw new Error("Development data tools are disabled in production.");
  }
}
