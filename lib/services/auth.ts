import { randomUUID } from "crypto";
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { isRateLimited, rateLimit } from "@/lib/auth/rate-limit";
import type { MfaChallengePayload, SessionPayload } from "@/lib/auth/session-token";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { idleTimeoutDefaultMinutes, isDemoMode, SESSION_ABSOLUTE_HOURS } from "@/lib/config";
import { AppError, forbidden, validationError } from "@/lib/domain/errors";
import { MIN_PASSWORD_LENGTH } from "@/lib/domain/schemas";
import type { Database, OrganizationMember, RequestContext, UserAccount } from "@/lib/domain/types";
import { appOrigin, sendEmail } from "@/lib/email/send";
import { openSecret, sealSecret } from "@/lib/security/crypto";
import { mutate, readDb } from "@/lib/store";
import { pushAudit } from "@/lib/services/events";

const MFA_CHALLENGE_MS = 5 * 60 * 1000;
const LOGIN_FAIL_LIMIT = 8;
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;

export function buildSession(
  db: Database,
  user: UserAccount,
  membership: OrganizationMember,
  now = Date.now(),
  method: "pwd" | "sso" = "pwd",
): SessionPayload {
  const organization = db.organizations.find((item) => item.id === membership.organizationId);
  const profile = db.profiles.find((item) => item.id === user.id);
  return {
    sub: user.id,
    org: membership.organizationId,
    role: membership.role,
    onboarded: Boolean(profile?.onboardingCompleted),
    sv: user.sessionVersion,
    iat: now,
    exp: now + SESSION_ABSOLUTE_HOURS * 3_600_000,
    last: now,
    idle: organization?.security.idleTimeoutMinutes ?? idleTimeoutDefaultMinutes(),
    // With SSO, MFA is enforced by the organization's identity provider (for example Entra Conditional Access).
    mfaEnroll: method === "pwd" && Boolean(organization?.security.requireMfa && !user.mfaEnabled),
    amr: method,
  };
}

/**
 * The membership a password sign-in may open. Organizations that require SSO are skipped,
 * except for owners, who keep password + MFA as a break-glass path if the identity provider fails.
 */
function passwordMembership(db: Database, userId: string): OrganizationMember | null {
  const memberships = db.organizationMembers.filter((item) => item.userId === userId && item.status === "ACTIVE");
  const allowed = memberships.filter((item) => {
    const org = db.organizations.find((row) => row.id === item.organizationId);
    return !org?.sso?.enabled || !org.sso.requireSso || item.role === "OWNER";
  });
  return allowed[0] ?? null;
}

function firstActiveMembership(db: Database, userId: string, preferredOrg?: string): OrganizationMember | null {
  const memberships = db.organizationMembers.filter((item) => item.userId === userId && item.status === "ACTIVE");
  return memberships.find((item) => item.organizationId === preferredOrg) ?? memberships[0] ?? null;
}

export type SignInResult = { kind: "session"; session: SessionPayload } | { kind: "mfa"; challenge: MfaChallengePayload };

export function signInWithPassword(email: string, password: string): SignInResult {
  const key = email.trim().toLowerCase();
  const failKey = `login-fail:${key}`;
  if (isRateLimited(failKey, LOGIN_FAIL_LIMIT)) {
    throw new AppError("Too many sign-in attempts. Try again in a few minutes.", "VALIDATION");
  }
  const db = readDb();
  const user = db.users.find((item) => item.email.toLowerCase() === key);
  if (!user) {
    burnPasswordCheck(password);
    rateLimit(failKey, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW_MS);
    throw new AppError("Email or password is incorrect.", "UNAUTHORIZED");
  }
  if (!verifyPassword(password, user.passwordHash)) {
    rateLimit(failKey, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW_MS);
    mutate((draft) => {
      const membership = firstActiveMembership(draft, user.id);
      if (membership) {
        pushAudit(draft, {
          organizationId: membership.organizationId,
          actorId: user.id,
          event: "auth.login_failed",
          resourceType: "user",
          resourceId: user.id,
          metadata: {},
        });
      }
    });
    throw new AppError("Email or password is incorrect.", "UNAUTHORIZED");
  }
  const membership = passwordMembership(db, user.id);
  if (!membership) {
    throw new AppError("Your organization signs in with SSO. Use Sign in with SSO and your work email.", "FORBIDDEN");
  }
  if (needsRehash(user.passwordHash)) {
    mutate((draft) => {
      const row = draft.users.find((item) => item.id === user.id);
      if (row) row.passwordHash = hashPassword(password);
    });
  }
  if (user.mfaEnabled) {
    return { kind: "mfa", challenge: { sub: user.id, org: membership.organizationId, exp: Date.now() + MFA_CHALLENGE_MS, purpose: "mfa" } };
  }
  return { kind: "session", session: completeSignIn(user.id, membership.organizationId, "password") };
}

function completeSignIn(userId: string, organizationId: string, method: "password" | "mfa" | "recovery_code"): SessionPayload {
  return mutate((draft) => {
    const user = draft.users.find((item) => item.id === userId);
    const membership = firstActiveMembership(draft, userId, organizationId);
    if (!user || !membership) throw new AppError("This account is not active in an organization.", "FORBIDDEN");
    const org = draft.organizations.find((row) => row.id === membership.organizationId);
    const breakGlass = Boolean(org?.sso?.enabled && org.sso.requireSso && membership.role === "OWNER");
    const now = new Date().toISOString();
    membership.lastActiveAt = now;
    membership.updatedAt = now;
    pushAudit(draft, {
      organizationId: membership.organizationId,
      actorId: user.id,
      event: breakGlass ? "auth.break_glass_login" : "auth.login",
      resourceType: "user",
      resourceId: user.id,
      metadata: { method },
    });
    return buildSession(draft, user, membership);
  });
}

export function verifyMfaChallengeCode(challenge: MfaChallengePayload, code: string): SessionPayload {
  const limitKey = `mfa:${challenge.sub}`;
  if (isRateLimited(limitKey, 5)) throw validationError("Too many codes tried. Sign in again in a few minutes.");
  const normalized = code.replace(/\s+/g, "");
  const outcome = mutate((db) => {
    const user = db.users.find((item) => item.id === challenge.sub);
    if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted) return null;
    if (/^\d{6}$/.test(normalized)) {
      const step = verifyTotp(openSecret(user.mfaSecretEncrypted), normalized, user.mfaLastStep);
      if (step === null) return null;
      user.mfaLastStep = step;
      return "mfa" as const;
    }
    const hash = hashToken(normalized.toLowerCase());
    const index = user.mfaRecoveryCodeHashes.indexOf(hash);
    if (index < 0) return null;
    user.mfaRecoveryCodeHashes.splice(index, 1);
    return "recovery_code" as const;
  });
  if (!outcome) {
    rateLimit(limitKey, 5, 15 * 60 * 1000);
    throw validationError("That code is not valid. Check the time on your device and try again.");
  }
  return completeSignIn(challenge.sub, challenge.org, outcome);
}

export function beginMfaEnrollment(ctx: RequestContext): { secret: string; uri: string } {
  const secret = newTotpSecret();
  mutate((db) => {
    const user = db.users.find((item) => item.id === ctx.userId);
    if (!user) throw validationError("Account not found.");
    user.mfaPendingSecretEncrypted = sealSecret(secret);
    user.updatedAt = new Date().toISOString();
  });
  return { secret, uri: otpauthUri(secret, ctx.email) };
}

export function confirmMfaEnrollment(ctx: RequestContext, code: string): { recoveryCodes: string[]; session: SessionPayload } {
  const codes = newRecoveryCodes();
  const session = mutate((db) => {
    const user = db.users.find((item) => item.id === ctx.userId);
    if (!user || !user.mfaPendingSecretEncrypted) throw validationError("Start enrollment again.");
    const secret = openSecret(user.mfaPendingSecretEncrypted);
    const step = verifyTotp(secret, code.replace(/\s+/g, ""), -1);
    if (step === null) throw validationError("That code did not match. Check the time on your device and try again.");
    user.mfaEnabled = true;
    user.mfaSecretEncrypted = user.mfaPendingSecretEncrypted;
    user.mfaPendingSecretEncrypted = null;
    user.mfaLastStep = step;
    user.mfaRecoveryCodeHashes = codes.map((value) => hashToken(value));
    user.sessionVersion += 1;
    user.updatedAt = new Date().toISOString();
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "auth.mfa_enabled",
      resourceType: "user",
      resourceId: ctx.userId,
      metadata: {},
    });
    const membership = firstActiveMembership(db, user.id, ctx.organizationId);
    if (!membership) throw forbidden();
    return buildSession(db, user, membership);
  });
  return { recoveryCodes: codes, session };
}

export function disableMfa(ctx: RequestContext, password: string): SessionPayload {
  return mutate((db) => {
    const user = db.users.find((item) => item.id === ctx.userId);
    if (!user || !verifyPassword(password, user.passwordHash)) throw validationError("Password is incorrect.");
    if (ctx.organization.security.requireMfa) throw validationError("Your organization requires two-factor sign-in.");
    user.mfaEnabled = false;
    user.mfaSecretEncrypted = null;
    user.mfaPendingSecretEncrypted = null;
    user.mfaRecoveryCodeHashes = [];
    user.sessionVersion += 1;
    user.updatedAt = new Date().toISOString();
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "auth.mfa_disabled",
      resourceType: "user",
      resourceId: ctx.userId,
      metadata: {},
    });
    const membership = firstActiveMembership(db, user.id, ctx.organizationId);
    if (!membership) throw forbidden();
    return buildSession(db, user, membership);
  });
}

/** Signs the user out everywhere by invalidating every issued session cookie. */
export function revokeAllSessions(ctx: RequestContext): void {
  mutate((db) => {
    const user = db.users.find((item) => item.id === ctx.userId);
    if (!user) return;
    user.sessionVersion += 1;
    user.updatedAt = new Date().toISOString();
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "auth.sessions_revoked",
      resourceType: "user",
      resourceId: ctx.userId,
      metadata: {},
    });
  });
}

export function newUserAccount(email: string, password: string, now: string): UserAccount {
  return {
    id: randomUUID(),
    email,
    passwordHash: hashPassword(password),
    sessionVersion: 1,
    identities: [],
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    mfaPendingSecretEncrypted: null,
    mfaRecoveryCodeHashes: [],
    mfaLastStep: -1,
    createdAt: now,
    updatedAt: now,
  };
}

export function signUpAccount(input: { fullName: string; email: string; password: string }): SessionPayload {
  const email = input.email.trim().toLowerCase();
  if (!rateLimit(`signup:${email}`, 5, 60 * 60 * 1000)) {
    throw validationError("Too many signup attempts. Try again later.");
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) throw validationError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  return mutate((db) => {
    if (db.users.some((item) => item.email.toLowerCase() === email)) {
      throw validationError("An account with that email already exists.");
    }
    const now = new Date().toISOString();
    const user = newUserAccount(email, input.password, now);
    const orgId = randomUUID();
    db.users.push(user);
    db.profiles.push({
      id: user.id,
      fullName: input.fullName.trim(),
      jobTitle: "",
      phone: "",
      onboardingCompleted: false,
      notificationPreferences: {
        caseAssigned: true,
        statusChanged: true,
        taskDue: true,
        aiComplete: true,
        emailEnabled: false,
      },
      createdAt: now,
      updatedAt: now,
    });
    db.organizations.push({
      id: orgId,
      name: "New organization",
      type: "CLINIC",
      specialty: "",
      providerCount: 1,
      workflows: {
        priorAuthorization: true,
        eligibility: false,
        referrals: false,
        denials: false,
        documentManagement: false,
      },
      security: { requireMfa: false, idleTimeoutMinutes: idleTimeoutDefaultMinutes() },
      caseSequence: 0,
      sso: null,
      scim: null,
      synthetic: false,
      createdAt: now,
      updatedAt: now,
      createdBy: user.id,
      updatedBy: user.id,
    });
    const membership: OrganizationMember = {
      id: randomUUID(),
      organizationId: orgId,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: user.id,
      updatedBy: user.id,
    };
    db.organizationMembers.push(membership);
    db.subscriptions.push({
      id: randomUUID(),
      organizationId: orgId,
      plan: "STARTER",
      status: "TRIALING",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      createdAt: now,
      updatedAt: now,
    });
    pushAudit(db, {
      organizationId: orgId,
      actorId: user.id,
      event: "organization.created",
      resourceType: "organization",
      resourceId: orgId,
      metadata: { name: "New organization" },
    });
    return buildSession(db, user, membership);
  });
}

/**
 * Always returns the same shape whether or not the email exists, so the form cannot be used
 * to discover accounts. The link is emailed. It is returned for on-screen display only in
 * demo mode, where email is not configured.
 */
export async function requestPasswordReset(email: string): Promise<{ demoResetPath: string | null }> {
  const key = email.trim().toLowerCase();
  if (!rateLimit(`reset:${key}`, 5, 60 * 60 * 1000)) {
    throw validationError("Too many reset requests. Try again later.");
  }
  const existing = readDb().users.find((item) => item.email.toLowerCase() === key);
  if (!existing) return { demoResetPath: null };
  const token = newToken();
  mutate((db) => {
    for (const record of db.passwordResetTokens) {
      if (record.userId === existing.id && !record.usedAt) record.usedAt = new Date().toISOString();
    }
    db.passwordResetTokens.push({
      id: randomUUID(),
      userId: existing.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
  });
  const path = `/reset-password?token=${encodeURIComponent(token)}`;
  const { delivered } = await sendEmail({
    to: existing.email,
    subject: "Reset your HealthFlow password",
    text: `Use this link within 30 minutes to choose a new password:\n\n${appOrigin()}${path}\n\nIf you did not ask for this, you can ignore this email.`,
  });
  return { demoResetPath: !delivered && isDemoMode() ? path : null };
}

export function resetPasswordWithToken(token: string, password: string): void {
  const tokenHash = hashToken(token);
  mutate((db) => {
    const record = db.passwordResetTokens.find((item) => item.tokenHash === tokenHash && !item.usedAt);
    if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
      throw validationError("This reset link is invalid or expired.");
    }
    const user = db.users.find((item) => item.id === record.userId);
    if (!user) throw validationError("This reset link is invalid or expired.");
    user.passwordHash = hashPassword(password);
    user.sessionVersion += 1;
    user.updatedAt = new Date().toISOString();
    record.usedAt = user.updatedAt;
    const membership = firstActiveMembership(db, user.id);
    if (membership) {
      pushAudit(db, {
        organizationId: membership.organizationId,
        actorId: user.id,
        event: "auth.password_reset",
        resourceType: "user",
        resourceId: user.id,
        metadata: {},
      });
    }
  });
}

export function changePassword(ctx: RequestContext, currentPassword: string, nextPassword: string): SessionPayload {
  if (nextPassword.length < MIN_PASSWORD_LENGTH) throw validationError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  return mutate((db) => {
    const user = db.users.find((item) => item.id === ctx.userId);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      throw validationError("Current password is incorrect.");
    }
    user.passwordHash = hashPassword(nextPassword);
    user.sessionVersion += 1;
    user.updatedAt = new Date().toISOString();
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "auth.password_changed",
      resourceType: "user",
      resourceId: user.id,
      metadata: {},
    });
    const membership = firstActiveMembership(db, user.id, ctx.organizationId);
    if (!membership) throw forbidden();
    return buildSession(db, user, membership);
  });
}

export function refreshSessionFor(ctx: RequestContext): SessionPayload {
  const db = readDb();
  const user = db.users.find((item) => item.id === ctx.userId);
  const membership = user ? firstActiveMembership(db, user.id, ctx.organizationId) : null;
  if (!user || !membership) throw forbidden();
  return buildSession(db, user, membership);
}

export function switchOrganization(ctx: RequestContext, organizationId: string): SessionPayload {
  const db = readDb();
  const membership = db.organizationMembers.find(
    (item) => item.userId === ctx.userId && item.organizationId === organizationId && item.status === "ACTIVE",
  );
  if (!membership) throw new AppError("You are not a member of that organization.", "FORBIDDEN");
  const user = db.users.find((item) => item.id === ctx.userId);
  if (!user) throw forbidden();
  return buildSession(db, user, membership);
}

export function listMemberships(ctx: RequestContext) {
  const db = readDb();
  return db.organizationMembers
    .filter((item) => item.userId === ctx.userId && item.status === "ACTIVE")
    .map((item) => {
      const organization = db.organizations.find((org) => org.id === item.organizationId);
      return {
        organizationId: item.organizationId,
        name: organization?.name ?? "Organization",
        role: item.role,
        synthetic: organization?.synthetic ?? false,
      };
    });
}

export function getSecurityState(ctx: RequestContext) {
  const user = readDb().users.find((item) => item.id === ctx.userId);
  return {
    mfaEnabled: Boolean(user?.mfaEnabled),
    recoveryCodesLeft: user?.mfaRecoveryCodeHashes.length ?? 0,
    orgRequiresMfa: ctx.organization.security.requireMfa,
    idleTimeoutMinutes: ctx.organization.security.idleTimeoutMinutes,
  };
}
