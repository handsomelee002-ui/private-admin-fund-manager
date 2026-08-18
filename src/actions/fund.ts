"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  assertNotFutureDate,
  buildNavPlatformPreview,
  createNavWeek,
  deleteDraftNavWeek,
  lockNavWeek,
  recordCashMovement,
  recordFixedSavings,
  recordPlatformValuation,
} from "@/lib/fundDb";

function parsePositiveMoney(value: FormDataEntryValue | null, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return amount;
}

function parseMoney(value: FormDataEntryValue | null, label: string) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return amount;
}

function revalidateFundViews(investorId?: string) {
  revalidatePath("/");
  revalidatePath("/nav");
  revalidatePath("/capital");
  revalidatePath("/brokerage");
  revalidatePath("/claims");
  revalidatePath("/fixed-savings");
  revalidatePath("/investors");
  revalidatePath("/reports");
  if (investorId) {
    revalidatePath(`/investors/${investorId}`);
  }
}

export async function createNavWeekAction(formData: FormData) {
  try {
    await requireAdmin();
    const weekEnding = formData.get("week_ending")?.toString();
    if (!weekEnding) return { error: "Valuation date is required." };
    assertNotFutureDate(weekEnding, "Valuation date");

    // Only platforms the operator explicitly overrode are sent. Everything else
    // is valued from its recorded valuations or computed holdings.
    const platformSnapshots = [...formData.entries()]
      .filter(([key, value]) => key.startsWith("platform_value_") && value.toString().trim() !== "")
      .map(([key, value]) => ({
        platformId: key.replace("platform_value_", ""),
        totalValue: parseMoney(value, "Platform value"),
      }));

    await createNavWeek({
      weekEnding,
      platformSnapshots,
      adjustments: parseMoney(formData.get("adjustments"), "Adjustments"),
      notes: formData.get("notes")?.toString() || "",
    });
    revalidateFundViews();
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create NAV week." };
  }
}

/** Value every platform for a date, for the NAV review screen. */
export async function getNavPreviewAction(asOfDate: string) {
  try {
    await requireAdmin();
    assertNotFutureDate(asOfDate, "Valuation date");
    const preview = await buildNavPlatformPreview(asOfDate);
    return { success: true as const, preview };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to build NAV preview." };
  }
}

/** Log what a platform is worth today, outside the NAV cycle. */
export async function recordPlatformValuationAction(formData: FormData) {
  try {
    await requireAdmin();
    const platformId = formData.get("platform_id")?.toString();
    const asOfDate = formData.get("as_of_date")?.toString();
    if (!platformId || !asOfDate) return { error: "Platform and valuation date are required." };

    const totalValue = Number(formData.get("total_value"));
    if (!Number.isFinite(totalValue) || totalValue < 0) {
      return { error: "Platform value must be zero or a positive number." };
    }

    await recordPlatformValuation({
      platformId,
      asOfDate,
      totalValue,
      source: "MANUAL",
      notes: formData.get("notes")?.toString() || "",
    });
    revalidateFundViews();
    revalidatePath("/trading");
    revalidatePath(`/trading/${platformId}`);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to record platform valuation." };
  }
}

export async function lockNavWeekAction(formData: FormData) {
  try {
    await requireAdmin();
    const id = formData.get("id")?.toString();
    if (!id) return { error: "NAV week id is required." };
    await lockNavWeek(id);
    revalidateFundViews();
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to lock NAV week." };
  }
}

export async function deleteDraftNavWeekAction(formData: FormData) {
  try {
    await requireAdmin();
    const id = formData.get("id")?.toString();
    if (!id) return { error: "NAV week id is required." };
    await deleteDraftNavWeek(id);
    revalidateFundViews();
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete NAV draft." };
  }
}

export async function recordCashMovementAction(formData: FormData) {
  try {
    await requireAdmin();
    const investorId = formData.get("investor_id")?.toString();
    const date = formData.get("date")?.toString();
    const type = formData.get("type")?.toString() as "Deposit" | "Withdrawal";
    if (!investorId || !date || !["Deposit", "Withdrawal"].includes(type)) {
      return { error: "Investor, date, and movement type are required." };
    }
    assertNotFutureDate(date, "Movement date");
    const withdrawAll = type === "Withdrawal" && formData.get("withdraw_all") === "true";
    const result = await recordCashMovement({
      investorId,
      date,
      type,
      amount: withdrawAll ? 0 : parsePositiveMoney(formData.get("amount"), "Amount"),
      withdrawAll,
      notes: formData.get("notes")?.toString() || "",
    });
    if ("error" in result) return result;
    revalidateFundViews(investorId);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to record cash movement." };
  }
}

export async function recordFixedSavingsAction(formData: FormData) {
  try {
    await requireAdmin();
    const investorId = formData.get("investor_id")?.toString();
    const date = formData.get("date")?.toString();
    const type = formData.get("type")?.toString() as "Deposit" | "Withdrawal";
    if (!investorId || !date || !["Deposit", "Withdrawal"].includes(type)) {
      return { error: "Investor, date, and fixed savings type are required." };
    }
    assertNotFutureDate(date, "Fixed savings date");
    await recordFixedSavings({
      investorId,
      date,
      type,
      amount: parsePositiveMoney(formData.get("amount"), "Amount"),
      notes: formData.get("notes")?.toString() || "",
    });
    revalidateFundViews(investorId);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to record fixed savings." };
  }
}
