"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/actions/result";
import { parseInput } from "@/lib/domain/schemas";
import { getRequestContext } from "@/lib/services/context";
import { runEligibilityCheck, saveClearinghouse, testClearinghouse } from "@/lib/services/integrations";

const clearinghouseSchema = z.object({
  provider: z.enum(["simulator", "stedi"]),
  environment: z.enum(["test", "production"]),
  apiKey: z.string().max(500).default(""),
  enabled: z.boolean(),
});

export async function saveClearinghouseAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(clearinghouseSchema, input);
    saveClearinghouse(ctx, { ...data, apiKey: data.apiKey ?? "" });
    revalidatePath("/integrations");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function testClearinghouseAction(): Promise<ActionResult<{ message: string }>> {
  try {
    const ctx = await getRequestContext();
    const result = await testClearinghouse(ctx);
    revalidatePath("/integrations");
    return result.ok ? { ok: true, data: { message: result.message } } : { ok: false, error: result.message };
  } catch (error) {
    return actionError(error);
  }
}

export async function eligibilityAction(authorizationId: string): Promise<ActionResult<{ status: string }>> {
  try {
    const ctx = await getRequestContext();
    const check = await runEligibilityCheck(ctx, z.string().uuid().parse(authorizationId));
    revalidatePath(`/authorizations/${authorizationId}`);
    return check.status === "ERROR" ? { ok: false, error: check.errorMessage } : { ok: true, data: { status: check.status } };
  } catch (error) {
    return actionError(error);
  }
}
