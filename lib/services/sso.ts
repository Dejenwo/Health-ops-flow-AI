import { randomBytes, randomUUID } from "crypto";
import { resolveTxt } from "dns/promises";
import { assertCan } from "@/lib/domain/permissions";
import { AppError, validationError } from "@/lib/domain/errors";
import type { Database, Organization, OrganizationMember, RequestContext, SsoConfig, SsoProvider, UserAccount } from "@/lib/domain/types";
import type { SessionPayload, SsoStatePayload } from "@/lib/auth/session-token";
import { authorizationUrl, discover, exchangeCode, randomToken, verifyIdToken, type OidcMetadata } from "@/lib/auth/oidc";
import { rateLimit } from "@/lib/auth/rate-limit";
import { appOrigin } from "@/lib/email/send";
import { openSecret, sealSecret } from "@/lib/security/crypto";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { mutate, readDb } from "@/lib/store";
import { pushAudit } from "@/lib/services/events";
import { buildSession } from "@/lib/services/auth";

/**
 * Single sign-on for organizations.
 *
 * Trust model, per provider:
 * - Microsoft Entra ID: the token must come from the organization's own tenant (issuer and `tid`
 *   both checked). The account is keyed on tenant + object ID, never on the email claim alone,
 *   because Entra email claims are not proof of mailbox ownership.
 * - Google Workspace: the token's `hd` (hosted domain) must be one of the organization's verified
 *   domains and `email_verified` must be true. Personal Gmail accounts have no `hd` and are refused.
 * - Other OIDC (Okta, Ping, OneLogin...): the organization's own issuer and client; `email_verified`
 *   must be true and the email domain must be verified.
 * In every case the email domain must be a domain the organization proved it owns through DNS.
 */

export const SSO_STATE_MS = 10 * 60 * 1000;
export const DOMAIN_TXT_HOST = "_healthflow";

/** Consumer mail domains can never be claimed by an organization. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com", "mail.com",
]);

const MICROSOFT_TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function redirectUri(): string {
  return `${appOrigin()}/api/auth/sso/callback`;
}

export function platformProviders(): Record<SsoProvider, boolean> {
  return {
    microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    oidc: true,
  };
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

function verifiedDomains(config: SsoConfig): string[] {
  return config.domains.filter((item) => item.verifiedAt).map((item) => item.domain);
}

function emptyConfig(): SsoConfig {
  return {
    enabled: false,
    provider: "microsoft",
    tenantId: "",
    issuer: "",
    clientId: "",
    clientSecretEncrypted: null,
    domains: [],
    jitProvisioning: true,
    defaultRole: "SPECIALIST",
    requireSso: false,
    lastLoginAt: null,
  };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export interface SsoSettingsInput {
  enabled: boolean;
  provider: SsoProvider;
  tenantId: string;
  issuer: string;
  clientId: string;
  /** Empty keeps the stored secret. */
  clientSecret: string;
  jitProvisioning: boolean;
  defaultRole: "VIEWER" | "SPECIALIST" | "MANAGER";
  requireSso: boolean;
}

export function getSsoSettings(ctx: RequestContext) {
  assertCan(ctx.role, "settings.security");
  const org = readDb().organizations.find((item) => item.id === ctx.organizationId);
  const config = org?.sso ?? emptyConfig();
  return {
    ...config,
    clientSecretEncrypted: undefined,
    hasClientSecret: Boolean(config.clientSecretEncrypted),
    redirectUri: redirectUri(),
    platform: platformProviders(),
  };
}

export function updateSsoSettings(ctx: RequestContext, input: SsoSettingsInput): void {
  assertCan(ctx.role, "settings.security");
  if (!["VIEWER", "SPECIALIST", "MANAGER"].includes(input.defaultRole)) throw validationError("New SSO accounts can be Viewer, Specialist or Manager.");
  const tenantId = input.tenantId.trim();
  const issuer = input.issuer.trim().replace(/\/$/, "");
  const clientId = input.clientId.trim();
  mutate((db) => {
    const org = requireOrg(db, ctx.organizationId);
    const current = org.sso ?? emptyConfig();
    const next: SsoConfig = {
      ...current,
      enabled: input.enabled,
      provider: input.provider,
      tenantId,
      issuer,
      clientId,
      clientSecretEncrypted: input.clientSecret ? sealSecret(input.clientSecret) : current.clientSecretEncrypted,
      jitProvisioning: input.jitProvisioning,
      defaultRole: input.defaultRole,
      requireSso: input.requireSso,
    };
    if (next.enabled) {
      if (!platformProviders()[next.provider]) throw validationError("That provider is not configured on this HealthFlow server yet.");
      if (next.provider === "microsoft" && !MICROSOFT_TENANT.test(tenantId)) {
        throw validationError("Enter your Microsoft Entra directory (tenant) ID. It looks like 72f988bf-86f1-41af-91ab-2d7cd011db47.");
      }
      if (next.provider === "oidc") {
        if (!/^https:\/\/[^/]+/.test(issuer)) throw validationError("Enter the issuer URL, starting with https://.");
        if (!clientId || !next.clientSecretEncrypted) throw validationError("Enter the client ID and client secret from your identity provider.");
      }
      if (verifiedDomains(next).length === 0) throw validationError("Verify at least one email domain before turning SSO on.");
    }
    if (next.requireSso && !next.enabled) throw validationError("Turn SSO on before requiring it.");
    org.sso = next;
    org.updatedAt = new Date().toISOString();
    org.updatedBy = ctx.userId;
    if (next.requireSso && !current.requireSso) {
      // Password sessions of members who now must use SSO end immediately (owners keep break-glass).
      const members = db.organizationMembers.filter((item) => item.organizationId === org.id && item.role !== "OWNER");
      for (const member of members) {
        const user = db.users.find((row) => row.id === member.userId);
        if (user) user.sessionVersion += 1;
      }
    }
    pushAudit(db, {
      organizationId: org.id,
      actorId: ctx.userId,
      event: "sso.settings_updated",
      resourceType: "organization",
      resourceId: org.id,
      metadata: {
        enabled: next.enabled,
        provider: next.provider,
        requireSso: next.requireSso,
        jitProvisioning: next.jitProvisioning,
        defaultRole: next.defaultRole,
        secretChanged: Boolean(input.clientSecret),
      },
    });
  });
}

export function addSsoDomain(ctx: RequestContext, rawDomain: string): { domain: string; txtHost: string; txtValue: string } {
  assertCan(ctx.role, "settings.security");
  const domain = rawDomain.trim().toLowerCase().replace(/^@/, "");
  if (!DOMAIN.test(domain)) throw validationError("Enter a domain like northstarclinic.com.");
  if (PUBLIC_DOMAINS.has(domain)) throw validationError("Public email domains cannot be used for SSO.");
  return mutate((db) => {
    const org = requireOrg(db, ctx.organizationId);
    const claimedElsewhere = db.organizations.some(
      (item) => item.id !== org.id && item.sso?.domains.some((entry) => entry.domain === domain && entry.verifiedAt),
    );
    if (claimedElsewhere) throw validationError("That domain is already verified by another organization.");
    org.sso ??= emptyConfig();
    let entry = org.sso.domains.find((item) => item.domain === domain);
    if (!entry) {
      if (org.sso.domains.length >= 10) throw validationError("An organization can verify up to 10 domains.");
      entry = { domain, verificationToken: randomBytes(16).toString("hex"), verifiedAt: null };
      org.sso.domains.push(entry);
      pushAudit(db, { organizationId: org.id, actorId: ctx.userId, event: "sso.domain_added", resourceType: "organization", resourceId: org.id, metadata: { domain } });
    }
    return { domain, txtHost: `${DOMAIN_TXT_HOST}.${domain}`, txtValue: `healthflow-verification=${entry.verificationToken}` };
  });
}

export function removeSsoDomain(ctx: RequestContext, domain: string): void {
  assertCan(ctx.role, "settings.security");
  mutate((db) => {
    const org = requireOrg(db, ctx.organizationId);
    if (!org.sso) return;
    const remaining = org.sso.domains.filter((item) => item.domain !== domain);
    if (org.sso.enabled && remaining.filter((item) => item.verifiedAt).length === 0) {
      throw validationError("Turn SSO off before removing the last verified domain.");
    }
    org.sso.domains = remaining;
    pushAudit(db, { organizationId: org.id, actorId: ctx.userId, event: "sso.domain_removed", resourceType: "organization", resourceId: org.id, metadata: { domain } });
  });
}

export type TxtResolver = (host: string) => Promise<string[][]>;

/** Checks the DNS TXT record proving the organization controls the domain. */
export async function verifySsoDomain(ctx: RequestContext, domain: string, resolver: TxtResolver = resolveTxt): Promise<boolean> {
  assertCan(ctx.role, "settings.security");
  const org = readDb().organizations.find((item) => item.id === ctx.organizationId);
  const entry = org?.sso?.domains.find((item) => item.domain === domain);
  if (!entry) throw validationError("Add the domain first.");
  if (entry.verifiedAt) return true;
  let records: string[][] = [];
  try {
    records = await resolver(`${DOMAIN_TXT_HOST}.${domain}`);
  } catch {
    records = [];
  }
  const expected = `healthflow-verification=${entry.verificationToken}`;
  const found = records.some((parts) => parts.join("").trim() === expected);
  if (!found) return false;
  mutate((db) => {
    const current = requireOrg(db, ctx.organizationId);
    const claimedElsewhere = db.organizations.some(
      (item) => item.id !== current.id && item.sso?.domains.some((other) => other.domain === domain && other.verifiedAt),
    );
    if (claimedElsewhere) throw validationError("That domain is already verified by another organization.");
    const target = current.sso?.domains.find((item) => item.domain === domain);
    if (target) target.verifiedAt = new Date().toISOString();
    pushAudit(db, { organizationId: current.id, actorId: ctx.userId, event: "sso.domain_verified", resourceType: "organization", resourceId: current.id, metadata: { domain } });
  });
  return true;
}

function requireOrg(db: Database, id: string): Organization {
  const org = db.organizations.find((item) => item.id === id);
  if (!org) throw validationError("Organization not found.");
  return org;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

interface ProviderSetup {
  issuer: string;
  clientId: string;
  clientSecret: string;
  extra: Record<string, string>;
}

function providerSetup(config: SsoConfig): ProviderSetup {
  if (config.provider === "microsoft") {
    return {
      issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
      clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      extra: {},
    };
  }
  if (config.provider === "google") {
    const [first] = verifiedDomains(config);
    return {
      issuer: "https://accounts.google.com",
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      extra: first ? { hd: first } : {},
    };
  }
  return {
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecret: config.clientSecretEncrypted ? openSecret(config.clientSecretEncrypted) : "",
    extra: {},
  };
}

/** Finds the organization that owns a work email's domain and has SSO switched on. */
export function findSsoOrganization(db: Database, email: string): Organization | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  return (
    db.organizations.find((org) => org.sso?.enabled && org.sso.domains.some((item) => item.domain === domain && item.verifiedAt)) ?? null
  );
}

export async function startSso(email: string, next?: string): Promise<{ url: string; state: SsoStatePayload }> {
  const address = email.trim().toLowerCase();
  if (!rateLimit(`sso-start:${address}`, 10, 10 * 60 * 1000)) throw validationError("Too many sign-in attempts. Try again in a few minutes.");
  const org = findSsoOrganization(readDb(), address);
  if (!org?.sso) throw validationError("SSO is not set up for that email domain. Sign in with your password, or ask your administrator.");
  const setup = providerSetup(org.sso);
  if (!setup.clientId || !setup.clientSecret) throw validationError("SSO for this organization is not fully configured.");
  const metadata = await discover(setup.issuer);
  const state: SsoStatePayload = {
    purpose: "sso",
    org: org.id,
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    next: safeNextPath(next),
    exp: Date.now() + SSO_STATE_MS,
  };
  const url = authorizationUrl({
    metadata,
    clientId: setup.clientId,
    redirectUri: redirectUri(),
    state: state.state,
    nonce: state.nonce,
    verifier: state.verifier,
    loginHint: address,
    extra: setup.extra,
  });
  return { url, state };
}

export class SsoError extends AppError {
  constructor(message: string) {
    super(message, "UNAUTHORIZED");
  }
}

interface VerifiedIdentity {
  key: string;
  email: string;
  name: string;
}

function checkClaims(config: SsoConfig, metadata: OidcMetadata, claims: Record<string, unknown>): VerifiedIdentity {
  const domains = verifiedDomains(config);
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  if (config.provider === "microsoft") {
    const tid = str(claims.tid);
    const oid = str(claims.oid);
    if (!tid || tid.toLowerCase() !== config.tenantId.toLowerCase()) throw new SsoError("This Microsoft account belongs to a different directory.");
    if (!oid) throw new SsoError("The Microsoft token did not identify the user.");
    const email = (str(claims.email) || str(claims.preferred_username)).toLowerCase();
    if (!domains.includes(emailDomain(email))) throw new SsoError("Your Microsoft account's email domain is not verified for this organization.");
    return { key: `microsoft:${tid}:${oid}`, email, name: str(claims.name) };
  }
  if (config.provider === "google") {
    const hd = str(claims.hd).toLowerCase();
    const email = str(claims.email).toLowerCase();
    if (!hd || !domains.includes(hd)) throw new SsoError("Sign in with your organization's Google Workspace account, not a personal Google account.");
    if (claims.email_verified !== true) throw new SsoError("Google did not confirm this email address.");
    if (emailDomain(email) !== hd) throw new SsoError("Your Google account's email domain is not verified for this organization.");
    return { key: `google:${str(claims.sub)}`, email, name: str(claims.name) };
  }
  const email = str(claims.email).toLowerCase();
  if (claims.email_verified !== true) throw new SsoError("Your identity provider did not confirm this email address.");
  if (!domains.includes(emailDomain(email))) throw new SsoError("Your email domain is not verified for this organization.");
  return { key: `oidc:${metadata.issuer}|${str(claims.sub)}`, email, name: str(claims.name) };
}

/**
 * Completes the round trip: checks state, redeems the code with PKCE, validates the ID token,
 * applies the provider trust rules, then links or provisions the account.
 */
export async function completeSso(state: SsoStatePayload | null, params: { code?: string | null; state?: string | null; error?: string | null }): Promise<{ session: SessionPayload; next: string }> {
  if (!state) throw new SsoError("Your sign-in expired. Start again.");
  if (params.error) throw new SsoError("The identity provider did not complete the sign-in.");
  if (!params.code || !params.state || params.state !== state.state) throw new SsoError("This sign-in response does not match the request. Start again.");
  const org = readDb().organizations.find((item) => item.id === state.org);
  if (!org?.sso?.enabled) throw new SsoError("SSO is no longer enabled for this organization.");
  const config = org.sso;
  const setup = providerSetup(config);
  let identity: VerifiedIdentity;
  try {
    const metadata = await discover(setup.issuer);
    const idToken = await exchangeCode({ metadata, clientId: setup.clientId, clientSecret: setup.clientSecret, redirectUri: redirectUri(), code: params.code, verifier: state.verifier });
    const claims = await verifyIdToken({ metadata, idToken, clientId: setup.clientId, nonce: state.nonce });
    identity = checkClaims(config, metadata, claims);
  } catch (error) {
    mutate((db) => pushAudit(db, { organizationId: org.id, actorId: null, event: "sso.login_failed", resourceType: "organization", resourceId: org.id, metadata: { reason: error instanceof SsoError ? error.message : "token validation failed" } }));
    if (error instanceof SsoError) throw error;
    throw new SsoError("Sign-in could not be verified. Start again, or contact your administrator.");
  }
  const session = mutate((db) => linkOrProvision(db, org.id, identity));
  return { session, next: state.next };
}

function linkOrProvision(db: Database, organizationId: string, identity: VerifiedIdentity): SessionPayload {
  const org = requireOrg(db, organizationId);
  const config = org.sso as SsoConfig;
  const now = new Date().toISOString();
  let user: UserAccount | undefined = db.users.find((item) => item.identities.some((entry) => entry.key === identity.key));
  let provisioned = false;
  if (!user) {
    // First SSO sign-in. The provider proved the email under a verified domain, so linking by email is safe.
    user = db.users.find((item) => item.email.toLowerCase() === identity.email);
    if (!user) {
      if (!config.jitProvisioning) throw new SsoError("You don't have a HealthFlow account yet. Ask your administrator to invite you.");
      user = {
        id: randomUUID(),
        email: identity.email,
        passwordHash: "",
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
      db.users.push(user);
      db.profiles.push({
        id: user.id,
        fullName: identity.name || identity.email.split("@")[0],
        jobTitle: "",
        phone: "",
        onboardingCompleted: true,
        notificationPreferences: { caseAssigned: true, statusChanged: true, taskDue: true, aiComplete: true, emailEnabled: false },
        createdAt: now,
        updatedAt: now,
      });
      provisioned = true;
    }
    user.identities.push({ key: identity.key, provider: config.provider, email: identity.email, linkedAt: now });
    user.updatedAt = now;
  }
  let membership: OrganizationMember | undefined = db.organizationMembers.find((item) => item.organizationId === org.id && item.userId === user!.id);
  if (membership && membership.status !== "ACTIVE") throw new SsoError("Your access to this organization is suspended. Contact your administrator.");
  if (!membership) {
    if (!config.jitProvisioning) throw new SsoError("You're not a member of this organization yet. Ask your administrator to invite you.");
    membership = {
      id: randomUUID(),
      organizationId: org.id,
      userId: user.id,
      role: config.defaultRole,
      status: "ACTIVE",
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: user.id,
      updatedBy: null,
    };
    db.organizationMembers.push(membership);
    pushAudit(db, { organizationId: org.id, actorId: user.id, event: "sso.user_provisioned", resourceType: "user", resourceId: user.id, metadata: { role: config.defaultRole, newAccount: provisioned } });
  }
  membership.lastActiveAt = now;
  config.lastLoginAt = now;
  pushAudit(db, { organizationId: org.id, actorId: user.id, event: "auth.login", resourceType: "user", resourceId: user.id, metadata: { method: "sso", provider: config.provider } });
  return buildSession(db, user, membership, Date.now(), "sso");
}
