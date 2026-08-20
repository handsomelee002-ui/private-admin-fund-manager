"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { ensureFixedSavingsRateTables } from "@/lib/fundDb";
import { isRedirectError, requireAdmin } from "@/lib/auth";

function parseRate(value: FormDataEntryValue | null) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("Rate must be between 0 and 100.");
  }
  return rate;
}

function parseOptionalMoney(value: FormDataEntryValue | null) {
  const raw = value?.toString().trim();
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Balance cap must be greater than zero.");
  }
  return amount;
}

function revalidateFixedSavingsRateViews() {
  revalidatePath("/");
  revalidatePath("/brokerage");
  revalidatePath("/fixed-savings");
  revalidatePath("/fixed-savings-rates");
  revalidatePath("/investors");
  revalidatePath("/reports");
}

export async function addFixedSavingsBaseRate(formData: FormData) {
  try {
    await requireAdmin();
    await ensureFixedSavingsRateTables();
    const effectiveDate = formData.get("effective_date")?.toString();
    if (!effectiveDate) return { error: "Effective date is required." };
    const rate = parseRate(formData.get("annual_rate_percent"));

    await sql`
      INSERT INTO fixed_savings_base_rates (effective_date, annual_rate_percent)
      VALUES (${effectiveDate}, ${rate})
      ON CONFLICT (effective_date) DO UPDATE SET annual_rate_percent = EXCLUDED.annual_rate_percent
    `;
    revalidateFixedSavingsRateViews();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to save base rate." };
  }
}

export async function addFixedSavingsPromotion(formData: FormData) {
  try {
    await requireAdmin();
    await ensureFixedSavingsRateTables();
    const name = formData.get("name")?.toString().trim();
    const startDate = formData.get("start_date")?.toString();
    const endDate = formData.get("end_date")?.toString();
    if (!name || !startDate || !endDate) return { error: "Name, start date, and end date are required." };
    if (endDate < startDate) return { error: "End date cannot be earlier than start date." };

    const overlap = await sql`
      SELECT id
      FROM fixed_savings_promotions
      WHERE status = 'active'
        AND daterange(start_date, end_date, '[]') && daterange(${startDate}::date, ${endDate}::date, '[]')
      LIMIT 1
    `;
    if (overlap.rows.length > 0) {
      return { error: "Active promotion periods cannot overlap." };
    }

    await sql`
      INSERT INTO fixed_savings_promotions (name, start_date, end_date, annual_rate_percent, balance_cap, notes)
      VALUES (
        ${name},
        ${startDate},
        ${endDate},
        ${parseRate(formData.get("annual_rate_percent"))},
        ${parseOptionalMoney(formData.get("balance_cap"))},
        ${formData.get("notes")?.toString().trim() || ""}
      )
    `;
    revalidateFixedSavingsRateViews();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to add promotion." };
  }
}

export async function disableFixedSavingsPromotion(id: string) {
  try {
    await requireAdmin();
    await ensureFixedSavingsRateTables();
    await sql`
      UPDATE fixed_savings_promotions
      SET status = 'disabled'
      WHERE id = ${id}
    `;
    revalidateFixedSavingsRateViews();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to disable promotion." };
  }
}
