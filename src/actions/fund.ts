"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  createNavWeek,
  deleteDraftNavWeek,
  lockNavWeek,
  recordCashMovement,
  recordFixedSavings,
} from "@/lib/fundDb";
import { getPlatforms } from "@/actions/trading";

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
    if (!weekEnding) return { error: "Week ending is required." };
    const platformValueEntries = [...formData.entries()].filter(([key]) => key.startsWith("platform_value_"));
    const platformMap: Map<string, any> = platformValueEntries.length > 0
      ? new Map((await getPlatforms()).map((item: any) => [item.id, item]))
      : new Map();
    const platformSnapshots = platformValueEntries.length > 0
      ? platformValueEntries.map(([key, value]) => {
          const platformId = key.replace("platform_value_", "");
          const platform = platformMap.get(platformId);
          if (!platform) throw new Error("Invalid platform NAV value.");
          return {
            platformId,
            unrealizedProfit: parseMoney(value, "Platform final value") - platform.netInvested,
          };
        })
      : [...formData.entries()]
          .filter(([key]) => key.startsWith("platform_unrealized_"))
          .map(([key, value]) => ({
            platformId: key.replace("platform_unrealized_", ""),
            unrealizedProfit: parseMoney(value, "Unrealized profit"),
          }));

    await createNavWeek({
      weekEnding,
      platformSnapshots,
      adjustments: parseMoney(formData.get("adjustments"), "Adjustments"),
      notes: "",
    });
    revalidateFundViews();
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create NAV week." };
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
