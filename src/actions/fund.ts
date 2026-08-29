"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError, requireAdmin, requireSession } from "@/lib/auth";
import {
  assertNotFutureDate,
  buildNavPlatformPreview,
  createNavWeek,
  getFundCashAsOf,
  getFundCashAttribution,
  getDraftNavOverrides,
  deleteDraftNavWeek,
  lockNavWeek,
  recordCashMovement,
  recordFixedSavings,
  splitNavPlatformValue,
  summarizeNavPlatformPreview,
} from "@/lib/fundDb";

function parsePositiveMoney(value: FormDataEntryValue | null, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return amount;
}

function parseNonNegativeMoney(value: FormDataEntryValue | null, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be zero or a positive number.`);
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
        // Same rule as recordPlatformValuation: a platform cannot be worth less
        // than nothing. The override path used to accept negatives it rejects.
        totalValue: parseNonNegativeMoney(value, "Platform value"),
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
      fundCashConfirmed: formData.get("fund_cash_confirmed")?.toString() === "1",
      adjustments: parseMoney(formData.get("adjustments"), "Adjustments"),
      notes: formData.get("notes")?.toString() || "",
    });
    revalidateFundViews();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to create NAV week." };
  }
}

/**
 * Value every platform for a date, for the NAV review screen.
 *
 * Takes the same overrides the save will take, so the gross assets shown are
 * arithmetically the number that gets locked. Letting the screen total the raw
 * platform values and the whole bank balance would show something the server
 * never computes.
 */
export async function getNavPreviewAction(
  asOfDate: string,
  overrides: { platformId: string; totalValue: number }[] = [],
  fundCashOverride?: number,
) {
  try {
    await requireSession();
    assertNotFutureDate(asOfDate, "Valuation date");
    const overrideMap = new Map(
      overrides
        .filter((override) => Number.isFinite(override.totalValue) && override.totalValue >= 0)
        .map((override) => [override.platformId, { totalValue: override.totalValue }]),
    );
    const [preview, fundCash, draftOverrides] = await Promise.all([
      buildNavPlatformPreview(asOfDate, overrideMap),
      getFundCashAsOf(asOfDate),
      // What a draft already saved for this date holds, so reopening the screen
      // resumes it instead of starting from carried forward values.
      getDraftNavOverrides(asOfDate),
    ]);
    const bankBalance =
      fundCashOverride !== undefined && Number.isFinite(fundCashOverride)
        ? fundCashOverride
        : fundCash.balance;
    // Show the operator which slice of the bank balance will actually price the
    // units, rather than letting the screen imply the whole balance does.
    const valueSplit = splitNavPlatformValue(summarizeNavPlatformPreview(preview));
    const attribution = await getFundCashAttribution({
      asOfDate,
      bankBalance,
      nonEquityValueInPlatforms: valueSplit.nonEquityValueInPlatforms,
      nonEquityPlatformProfitLoss: valueSplit.nonEquityPlatformProfitLoss,
    });
    return {
      success: true as const,
      preview,
      fundCash,
      draftOverrides,
      attribution,
      equityPlatformValue: valueSplit.equityPlatformValue,
      grossAssets: Math.round((valueSplit.equityPlatformValue + attribution.equity) * 100) / 100,
    };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to build NAV preview." };
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
    if (isRedirectError(error)) throw error;
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
    if (isRedirectError(error)) throw error;
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
    if (isRedirectError(error)) throw error;
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
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to record fixed savings." };
  }
}
