"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/actions/result";
import { parseInput, ssoDomainSchema, ssoSettingsSchema } from "@/lib/domain/schemas";
import { getRequestContext } from "@/lib/services/context";
import { addSsoDomain, removeSsoDomain, updateSsoSettings, verifySsoDomain } from "@/lib/services/sso";
import { revokeScimToken, rotateScimToken } from "@/lib/services/scim";

export async function ssoSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(ssoSettingsSchema, input);
    updateSsoSettings(ctx, {
      ...data,
      tenantId: data.tenantId ?? "",
      issuer: data.issuer ?? "",
      clientId: data.clientId ?? "",
      clientSecret: data.clientSecret ?? "",
    });
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function addSsoDomainAction(input: unknown): Promise<ActionResult<{ txtHost: string; txtValue: string }>> {
  try {
    const ctx = await getRequestContext();
    const { domain } = parseInput(ssoDomainSchema, input);
    const result = addSsoDomain(ctx, domain);
    revalidatePath("/settings/security");
    return { ok: true, data: { txtHost: result.txtHost, txtValue: result.txtValue } };
  } catch (error) {
    return actionError(error);
  }
}

export async function verifySsoDomainAction(input: unknown): Promise<ActionResult<{ verified: boolean }>> {
  try {
    const ctx = await getRequestContext();
    const { domain } = parseInput(ssoDomainSchema, input);
    const verified = await verifySsoDomain(ctx, domain);
    revalidatePath("/settings/security");
    return { ok: true, data: { verified } };
  } catch (error) {
    return actionError(error);
  }
}

export async function removeSsoDomainAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const { domain } = parseInput(ssoDomainSchema, input);
    removeSsoDomain(ctx, domain);
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function rotateScimTokenAction(): Promise<ActionResult<{ token: string }>> {
  try {
    const ctx = await getRequestContext();
    const token = rotateScimToken(ctx);
    revalidatePath("/settings/security");
    return { ok: true, data: { token } };
  } catch (error) {
    return actionError(error);
  }
}

export async function revokeScimTokenAction(): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    revokeScimToken(ctx);
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}
