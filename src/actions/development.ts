"use server";

import { revalidatePath } from "next/cache";
import { assertAdminPassword, assertDevelopmentDataToolsEnabled, isRedirectError, requireAdmin } from "@/lib/auth";
import { cleanAllData, dropAllFundTables, initializeFreshFundDatabase, seedDummyData } from "@/lib/fundDb";

const CLEAN_CONFIRMATION = "DELETE ALL FUND DATA";
const DROP_CONFIRMATION = "DROP ALL FUND TABLES";
const SEED_CONFIRMATION = "IMPORT DUMMY DATA";
const INIT_CONFIRMATION = "INITIALIZE DATABASE";

function revalidateAll() {
  revalidatePath("/", "layout");
}

export async function importDummyDataAction(formData: FormData) {
  try {
    await requireAdmin();
    assertDevelopmentDataToolsEnabled();
    assertAdminPassword(formData.get("admin_password")?.toString());
    if (formData.get("confirmation")?.toString() !== SEED_CONFIRMATION) {
      return { error: `Type ${SEED_CONFIRMATION} to import dummy data.` };
    }
    await seedDummyData();
    revalidateAll();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to import dummy data." };
  }
}

export async function initializeDatabaseAction(formData: FormData) {
  try {
    await requireAdmin();
    assertDevelopmentDataToolsEnabled();
    assertAdminPassword(formData.get("admin_password")?.toString());
    if (formData.get("confirmation")?.toString() !== INIT_CONFIRMATION) {
      return { error: `Type ${INIT_CONFIRMATION} to initialize the database.` };
    }
    await initializeFreshFundDatabase();
    revalidateAll();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to initialize database." };
  }
}

export async function dropAllTablesAction(formData: FormData) {
  try {
    await requireAdmin();
    assertDevelopmentDataToolsEnabled();
    assertAdminPassword(formData.get("admin_password")?.toString());
    if (formData.get("confirmation")?.toString() !== DROP_CONFIRMATION) {
      return { error: `Type ${DROP_CONFIRMATION} to drop all fund tables.` };
    }
    await dropAllFundTables();
    revalidateAll();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to drop fund tables." };
  }
}

export async function cleanAllDataAction(formData: FormData) {
  try {
    await requireAdmin();
    assertDevelopmentDataToolsEnabled();
    assertAdminPassword(formData.get("admin_password")?.toString());
    if (formData.get("confirmation")?.toString() !== CLEAN_CONFIRMATION) {
      return { error: `Type ${CLEAN_CONFIRMATION} to clean all data.` };
    }
    await cleanAllData();
    revalidateAll();
    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: error instanceof Error ? error.message : "Failed to clean data." };
  }
}
