"use server";

import { sendEmail, appOrigin } from "@/lib/email/send";
import { isDemoMode } from "@/lib/config";
import { switchOrganization } from "@/lib/services/auth";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, formString, type ActionResult } from "@/lib/actions/result";
import { writeSession } from "@/lib/auth/cookies";
import {
  contactSchema,
  inviteSchema,
  notificationPrefsSchema,
  organizationSettingsSchema,
  parseInput,
  planChangeSchema,
  profileSchema,
  roleChangeSchema,
} from "@/lib/domain/schemas";
import { getRequestContext } from "@/lib/services/context";
import {
  acceptInvitation,
  changeMemberRole,
  changePlan,
  inviteMember,
  requestIntegration,
  submitContact,
  updateNotificationPreferences,
  updateOrganization,
  updateProfile,
} from "@/lib/services/admin";

export async function inviteAction(input: unknown): Promise<ActionResult<{ token: string | null; emailed: boolean }>> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(inviteSchema, input);
    const result = inviteMember(ctx, data.email, data.role);
    const { delivered } = await sendEmail({
      to: data.email,
      subject: `You're invited to ${ctx.organization.name} on HealthFlow`,
      text: `${ctx.profile.fullName} invited you to join ${ctx.organization.name}.\n\nSign in or create an account with this email address, then open:\n${appOrigin()}/invite/${result.token}\n\nThe link expires in 7 days.`,
    });
    revalidatePath("/team");
    // The raw token is only shown on screen in demo mode, where email is not configured.
    return { ok: true, data: { token: delivered || !isDemoMode() ? null : result.token, emailed: delivered } };
  } catch (error) {
    return actionError(error);
  }
}

export async function roleAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(roleChangeSchema, input);
    changeMemberRole(ctx, data.memberId, data.role);
    revalidatePath("/team");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function acceptInviteAction(token: string): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const joined = acceptInvitation(ctx, token);
    const session = switchOrganization(ctx, joined.organizationId);
    await writeSession(session);
    redirect(session.mfaEnroll ? "/settings/security?enroll=1" : "/dashboard");
  } catch (error) {
    return actionError(error);
  }
}

export async function profileAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(profileSchema, input);
    updateProfile(ctx, { fullName: data.fullName, jobTitle: data.jobTitle, phone: data.phone || "" });
    revalidatePath("/settings/profile");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function organizationAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(organizationSettingsSchema, input);
    updateOrganization(ctx, data);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function notificationPrefsAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(notificationPrefsSchema, input);
    updateNotificationPreferences(ctx, data);
    revalidatePath("/settings/notifications");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function planAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(planChangeSchema, input);
    changePlan(ctx, data.plan);
    revalidatePath("/settings/billing");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function integrationRequestAction(providerKey: string): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    requestIntegration(ctx, providerKey);
    revalidatePath("/integrations");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function contactAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const input = parseInput(contactSchema, {
      name: formString(formData, "name"),
      email: formString(formData, "email"),
      organization: formString(formData, "organization"),
      message: formString(formData, "message"),
    });
    submitContact(input);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}
