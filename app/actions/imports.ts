"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/actions/result";
import { parseInput } from "@/lib/domain/schemas";
import { getRequestContext } from "@/lib/services/context";
import { commitImport, IMPORT_KINDS, MAX_IMPORT_BYTES, previewImport, type ImportPreview } from "@/lib/services/imports";
import { deleteAuthRule, saveAuthRule } from "@/lib/services/auth-rules";

const importSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  csv: z.string().min(1, "Choose a CSV file.").max(MAX_IMPORT_BYTES + 1024, "The file is larger than 2 MB."),
  mode: z.enum(["skip", "update"]),
});

export async function previewImportAction(input: unknown): Promise<ActionResult<ImportPreview>> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(importSchema, input);
    return { ok: true, data: previewImport(ctx, data.kind, data.csv, data.mode) };
  } catch (error) {
    return actionError(error);
  }
}

export async function commitImportAction(input: unknown): Promise<ActionResult<{ created: number; updated: number; skipped: number; errors: number }>> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(importSchema, input);
    const counts = commitImport(ctx, data.kind, data.csv, data.mode);
    for (const path of ["/patients", "/providers", "/payers", "/payers/rules", "/dashboard"]) revalidatePath(path);
    return { ok: true, data: counts };
  } catch (error) {
    return actionError(error);
  }
}

const ruleSchema = z.object({
  payerId: z.string().uuid("Choose a payer."),
  codeType: z.enum(["CPT", "HCPCS"]),
  code: z.string().trim().min(1, "Enter a code.").max(6),
  requirement: z.enum(["REQUIRED", "NOT_REQUIRED"]),
  note: z.string().max(300).default(""),
});

export async function saveAuthRuleAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(ruleSchema, input);
    saveAuthRule(ctx, { ...data, note: data.note ?? "" });
    revalidatePath("/payers/rules");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteAuthRuleAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    deleteAuthRule(ctx, id);
    revalidatePath("/payers/rules");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}
