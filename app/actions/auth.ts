"use server";

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { DEMO_PASSWORD } from "@/lib/demo/accounts";
import { actionError, formString, type ActionResult } from "@/lib/actions/result";
import { clearSession, readMfaChallengeToken, writeMfaChallenge, writeSession } from "@/lib/auth/cookies";
import { verifyMfaChallenge } from "@/lib/auth/session-token";
import { isDemoMode } from "@/lib/config";
import { safeNextPath } from "@/lib/security/safe-redirect";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  mfaCodeSchema,
  onboardingSchema,
  orgSecuritySchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  parseInput,
} from "@/lib/domain/schemas";
import {
  beginMfaEnrollment,
  changePassword,
  confirmMfaEnrollment,
  disableMfa,
  refreshSessionFor,
  requestPasswordReset,
  resetPasswordWithToken,
  revokeAllSessions,
  signInWithPassword,
  signUpAccount,
  switchOrganization,
  verifyMfaChallengeCode,
} from "@/lib/services/auth";
import { completeOnboarding, updateOrganizationSecurity } from "@/lib/services/admin";
import { getRequestContext } from "@/lib/services/context";
import { validationError } from "@/lib/domain/errors";

function landingFor(session: { onboarded: boolean; mfaEnroll: boolean }, next?: string): string {
  if (!session.onboarded) return "/onboarding";
  if (session.mfaEnroll) return "/settings/security?enroll=1";
  return safeNextPath(next);
}

export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const input = parseInput(signInSchema, {
      email: formString(formData, "email"),
      password: formString(formData, "password"),
      next: formString(formData, "next"),
    });
    const result = signInWithPassword(input.email, input.password);
    if (result.kind === "mfa") {
      await writeMfaChallenge(result.challenge);
      redirect(`/login/mfa${input.next ? `?next=${encodeURIComponent(safeNextPath(input.next))}` : ""}`);
    }
    await writeSession(result.session);
    redirect(landingFor(result.session, input.next));
  } catch (error) {
    return actionError(error);
  }
}

export async function mfaVerifyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const challenge = verifyMfaChallenge(await readMfaChallengeToken());
    if (!challenge) throw validationError("Your sign-in expired. Enter your password again.");
    const { code } = parseInput(mfaCodeSchema, { code: formString(formData, "code") });
    const session = verifyMfaChallengeCode(challenge, code);
    await writeSession(session);
    redirect(landingFor(session, formString(formData, "next")));
  } catch (error) {
    return actionError(error);
  }
}

export async function signUpAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const input = parseInput(signUpSchema, {
      fullName: formString(formData, "fullName"),
      email: formString(formData, "email"),
      password: formString(formData, "password"),
    });
    const session = signUpAccount(input);
    await writeSession(session);
    redirect("/onboarding");
  } catch (error) {
    return actionError(error);
  }
}

export async function demoLoginAction(): Promise<void> {
  if (!isDemoMode()) redirect("/login");
  try {
    const result = signInWithPassword("owner@northstar.demo", DEMO_PASSWORD);
    if (result.kind !== "session") redirect("/login");
    await writeSession(result.session);
  } catch (error) {
    actionError(error);
    redirect("/login");
  }
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await clearSession();
  redirect("/");
}

export async function forgotPasswordAction(
  _prev: ActionResult<{ resetPath: string | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ resetPath: string | null }>> {
  try {
    const input = parseInput(forgotPasswordSchema, { email: formString(formData, "email") });
    const result = await requestPasswordReset(input.email);
    return { ok: true, data: { resetPath: result.demoResetPath } };
  } catch (error) {
    return actionError(error);
  }
}

export async function resetPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const input = parseInput(resetPasswordSchema, {
      token: formString(formData, "token"),
      password: formString(formData, "password"),
    });
    resetPasswordWithToken(input.token, input.password);
    await clearSession();
    redirect("/login?reset=1");
  } catch (error) {
    return actionError(error);
  }
}

export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const input = parseInput(changePasswordSchema, {
      currentPassword: formString(formData, "currentPassword"),
      nextPassword: formString(formData, "nextPassword"),
    });
    const session = changePassword(ctx, input.currentPassword, input.nextPassword);
    await writeSession(session);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function beginMfaAction(): Promise<ActionResult<{ secret: string; qr: string }>> {
  try {
    const ctx = await getRequestContext();
    const { secret, uri } = beginMfaEnrollment(ctx);
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 192 });
    return { ok: true, data: { secret, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` } };
  } catch (error) {
    return actionError(error);
  }
}

export async function confirmMfaAction(code: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  try {
    const ctx = await getRequestContext();
    const parsed = parseInput(mfaCodeSchema, { code });
    const { recoveryCodes, session } = confirmMfaEnrollment(ctx, parsed.code);
    await writeSession(session);
    return { ok: true, data: { recoveryCodes } };
  } catch (error) {
    return actionError(error);
  }
}

export async function disableMfaAction(password: string): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const session = disableMfa(ctx, password);
    await writeSession(session);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function revokeSessionsAction(): Promise<void> {
  const ctx = await getRequestContext();
  revokeAllSessions(ctx);
  await clearSession();
  redirect("/login?reason=signed-out-everywhere");
}

export async function orgSecurityAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(orgSecuritySchema, input);
    updateOrganizationSecurity(ctx, data);
    // Enabling the requirement revokes sessions of members without MFA, including possibly this one.
    await writeSession(refreshSessionFor(ctx));
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function switchOrgAction(formData: FormData): Promise<void> {
  const ctx = await getRequestContext();
  const session = switchOrganization(ctx, formString(formData, "organizationId"));
  await writeSession(session);
  redirect(landingFor(session));
}

export async function completeOnboardingAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(onboardingSchema, input);
    completeOnboarding(ctx, {
      organizationName: data.organizationName,
      organizationType: data.organizationType,
      specialty: data.specialty,
      providerCount: data.providerCount,
      fullName: data.fullName,
      jobTitle: data.jobTitle,
      phone: data.phone || "",
      workflows: {
        priorAuthorization: true,
        eligibility: Boolean(data.eligibility),
        referrals: Boolean(data.referrals),
        denials: Boolean(data.denials),
        documentManagement: Boolean(data.documentManagement),
      },
    });
    const session = refreshSessionFor(ctx);
    await writeSession(session);
    redirect(landingFor(session));
  } catch (error) {
    return actionError(error);
  }
}
