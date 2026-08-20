"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  assertNotFutureDate,
  buildNavPlatformPreview,
  createNavWeek,
  getFundCashAsOf,
  deleteDraftNavWeek,
  lockNavWeek,
  recordCashMovement,
  recordFixedSavings,
  recordFundCash,
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
    // is valued from its recorded value marks, carried forward.
    const platformSnapshots = [...formData.entries()]
      .filter(([key, value]) => key.startsWith("platform_value_") && value.toString().trim() !== "")
      .map(([key, value]) => ({
        platformId: key.replace("platform_value_", ""),
        totalValue: parseMoney(value, "Platform value"),
      }));

    const fundCashRaw = formData.get("fund_cash");
    const fundCash =
      fundCashRaw !== null && fundCashRaw.toString().trim() !== ""
        ? parseMoney(fundCashRaw, "Fund cash")
        : undefined;

    await createNavWeek({
      weekEnding,
      platformSnapshots,
      fundCash,
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
    const [preview, fundCash] = await Promise.all([
      buildNavPlatformPreview(asOfDate),
      getFundCashAsOf(asOfDate),
    ]);
    return { success: true as const, preview, fundCash };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to build NAV preview." };
  }
}

/** Record the fund's own cash balance, outside the NAV cycle. */
export async function recordFundCashAction(formData: FormData) {
  try {
    await requireAdmin();
    const asOfDate = formData.get("as_of_date")?.toString();
    if (!asOfDate) return { error: "As-of date is required." };
    assertNotFutureDate(asOfDate, "Fund cash date");

    const balance = Number(formData.get("balance"));
    if (!Number.isFinite(balance) || balance < 0) {
      return { error: "Fund cash balance must be zero or a positive number." };
    }

    await recordFundCash({ asOfDate, balance, notes: formData.get("notes")?.toString() || "" });
    revalidateFundViews();
    revalidatePath("/trading");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to record fund cash." };
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
