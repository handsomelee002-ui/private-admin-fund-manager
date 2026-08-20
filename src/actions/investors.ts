"use server";

import { createHash } from "node:crypto";
import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { generatePortalAccessId, isRedirectError, requireAdmin } from "@/lib/auth";
import { ensureAuditColumns, getInvestorsWithBalances, writeAuditEvent } from "@/lib/fundDb";

function hashPortalAccessId(portalAccessId: string | null | undefined) {
  return portalAccessId ? createHash("sha256").update(portalAccessId).digest("base64url") : null;
}

export async function getInvestors() {
  await requireAdmin();
  try {
    return await getInvestorsWithBalances();
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("Database Error:", error);
    throw new Error("Failed to fetch investors.");
  }
}

export async function addInvestor(formData: FormData) {
  await requireAdmin();
  const name = formData.get("name")?.toString()?.trim();
  if (!name) return { error: "Name is required" };

  try {
    const portalAccessId = generatePortalAccessId();
    const existing = await sql`SELECT id FROM investors WHERE name = ${name}`;
    if (existing.rows.length > 0) {
      return { error: "An investor with this name already exists." };
    }

    await sql`
      INSERT INTO investors (name, portal_access_id, portal_access_rotated_at)
      VALUES (${name}, ${portalAccessId}, NOW())
    `;
    revalidatePath("/investors");
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("Database Error:", error);
    return { error: "Failed to add investor." };
  }
}

export async function rotateInvestorPortalAccess(id: string) {
  await requireAdmin();
  await ensureAuditColumns();
  const portalAccessId = generatePortalAccessId();

  try {
    const updated = await sql`
      UPDATE investors
      SET portal_access_id = ${portalAccessId}, portal_access_rotated_at = NOW()
      WHERE id = ${id}
      RETURNING id, portal_access_id
    `;
    if (updated.rows.length === 0) return { error: "Investor not found." };

    await writeAuditEvent("portal_access.rotate", "investors", id, {
      newPortalAccessHash: hashPortalAccessId(portalAccessId),
    });
    revalidatePath("/investors");
    revalidatePath(`/investors/${id}`);
    return { success: true, portalAccessId };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("Database Error:", error);
    return { error: "Failed to rotate portal access." };
  }
}

export async function deleteInvestor(id: string) {
  await requireAdmin();
  void id;
  return { error: "Investor records cannot be hard-deleted in production. Use reversible ledger adjustments and mark the investor inactive in a dedicated workflow." };
}

export async function updateInvestorName(formData: FormData) {
  await requireAdmin();
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString()?.trim();
  if (!id || !name) return { error: "ID and new name are required" };

  try {
    const existing = await sql`SELECT id FROM investors WHERE name = ${name} AND id != ${id}`;
    if (existing.rows.length > 0) {
      return { error: "An investor with this name already exists." };
    }

    await sql`UPDATE investors SET name = ${name} WHERE id = ${id}`;
    revalidatePath("/investors");
    revalidatePath(`/investors/${id}`);
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    console.error("Database Error:", error);
    return { error: "Failed to update investor name." };
  }
}

