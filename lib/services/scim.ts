import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import { validationError } from "@/lib/domain/errors";
import type { Database, Organization, OrganizationMember, RequestContext, UserAccount } from "@/lib/domain/types";
import { rateLimit } from "@/lib/auth/rate-limit";
import { appOrigin } from "@/lib/email/send";
import { mutate, readDb } from "@/lib/store";
import { pushAudit } from "@/lib/services/events";

/**
 * SCIM 2.0 (RFC 7643/7644) user provisioning, the subset Microsoft Entra ID and Okta use:
 * list/filter, get, create, replace, patch and delete Users. Groups are not supported.
 *
 * Deprovisioning suspends the membership and revokes every session at once. Records are never
 * deleted, because audit history must stay intact. Owners cannot be changed through SCIM, so a
 * misconfigured identity provider cannot lock an organization out.
 */

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export interface ScimResponse {
  status: number;
  body?: unknown;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function scimBaseUrl(): string {
  return `${appOrigin()}/api/scim/v2`;
}

// ---------------------------------------------------------------------------
// Token administration
// ---------------------------------------------------------------------------

export function getScimStatus(ctx: RequestContext) {
  assertCan(ctx.role, "settings.security");
  const org = readDb().organizations.find((item) => item.id === ctx.organizationId);
  return {
    baseUrl: scimBaseUrl(),
    enabled: Boolean(org?.scim),
    tokenPrefix: org?.scim?.tokenPrefix ?? null,
    createdAt: org?.scim?.createdAt ?? null,
    lastUsedAt: org?.scim?.lastUsedAt ?? null,
  };
}

/** Creates or replaces the organization's SCIM token. The token is shown once and only its hash is stored. */
export function rotateScimToken(ctx: RequestContext): string {
  assertCan(ctx.role, "settings.security");
  const token = `hfscim_${randomBytes(32).toString("base64url")}`;
  mutate((db) => {
    const org = requireOrg(db, ctx.organizationId);
    const replaced = Boolean(org.scim);
    org.scim = { tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), createdAt: new Date().toISOString(), createdBy: ctx.userId, lastUsedAt: null };
    pushAudit(db, { organizationId: org.id, actorId: ctx.userId, event: replaced ? "scim.token_rotated" : "scim.token_created", resourceType: "organization", resourceId: org.id, metadata: {} });
  });
  return token;
}

export function revokeScimToken(ctx: RequestContext): void {
  assertCan(ctx.role, "settings.security");
  mutate((db) => {
    const org = requireOrg(db, ctx.organizationId);
    org.scim = null;
    pushAudit(db, { organizationId: org.id, actorId: ctx.userId, event: "scim.token_revoked", resourceType: "organization", resourceId: org.id, metadata: {} });
  });
}

function requireOrg(db: Database, id: string): Organization {
  const org = db.organizations.find((item) => item.id === id);
  if (!org) throw validationError("Organization not found.");
  return org;
}

function organizationForToken(db: Database, authorization: string | null): Organization | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!match) return null;
  const hash = Buffer.from(hashToken(match[1]), "hex");
  for (const org of db.organizations) {
    if (!org.scim) continue;
    const stored = Buffer.from(org.scim.tokenHash, "hex");
    if (stored.length === hash.length && timingSafeEqual(stored, hash)) return org;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

function error(status: number, detail: string, scimType?: string): ScimResponse {
  return { status, body: { schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) } };
}

function toScimUser(db: Database, org: Organization, member: OrganizationMember, user: UserAccount) {
  const profile = db.profiles.find((item) => item.id === user.id);
  const fullName = profile?.fullName ?? "";
  const [givenName, ...rest] = fullName.split(" ");
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    externalId: member.scimExternalId ?? undefined,
    userName: user.email,
    name: { formatted: fullName, givenName: givenName ?? "", familyName: rest.join(" ") },
    displayName: fullName,
    emails: [{ value: user.email, type: "work", primary: true }],
    active: member.status === "ACTIVE",
    meta: {
      resourceType: "User",
      created: member.createdAt,
      lastModified: member.updatedAt,
      location: `${scimBaseUrl()}/Users/${user.id}`,
    },
  };
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

interface UserPatch {
  userName?: string;
  fullName?: string;
  givenName?: string;
  familyName?: string;
  active?: boolean;
  externalId?: string;
}

function patchFromResource(body: Record<string, unknown>): UserPatch {
  const name = (body.name ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(body.emails) ? (body.emails as Record<string, unknown>[]) : [];
  const primary = emails.find((item) => item.primary === true) ?? emails[0];
  const out: UserPatch = {};
  if (typeof body.userName === "string") out.userName = body.userName;
  else if (primary && typeof primary.value === "string") out.userName = primary.value;
  if (typeof name.formatted === "string" && name.formatted) out.fullName = name.formatted;
  else if (typeof body.displayName === "string" && body.displayName) out.fullName = body.displayName;
  if (typeof name.givenName === "string") out.givenName = name.givenName;
  if (typeof name.familyName === "string") out.familyName = name.familyName;
  const active = asBool(body.active);
  if (active !== null) out.active = active;
  if (typeof body.externalId === "string") out.externalId = body.externalId;
  return out;
}

function patchFromOperations(body: Record<string, unknown>): UserPatch | null {
  if (!Array.isArray(body.Operations)) return null;
  const out: UserPatch = {};
  for (const raw of body.Operations as Record<string, unknown>[]) {
    const op = String(raw.op ?? "").toLowerCase();
    if (op !== "replace" && op !== "add") continue;
    const path = typeof raw.path === "string" ? raw.path : "";
    if (!path && raw.value && typeof raw.value === "object") {
      Object.assign(out, patchFromResource(raw.value as Record<string, unknown>));
      continue;
    }
    const value = raw.value;
    if (path === "active") {
      const bool = asBool(value);
      if (bool !== null) out.active = bool;
    } else if (path === "userName" && typeof value === "string") out.userName = value;
    else if ((path === "displayName" || path === "name.formatted") && typeof value === "string") out.fullName = value;
    else if (path === "name.givenName" && typeof value === "string") out.givenName = value;
    else if (path === "name.familyName" && typeof value === "string") out.familyName = value;
    else if (path === "externalId" && typeof value === "string") out.externalId = value;
    else if (/^emails(\[.*\])?(\.value)?$/.test(path) && typeof value === "string") out.userName = value;
  }
  return out;
}

function verifiedDomains(org: Organization): string[] {
  return org.sso?.domains.filter((item) => item.verifiedAt).map((item) => item.domain) ?? [];
}

function checkEmail(org: Organization, email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "userName must be an email address.";
  const domains = verifiedDomains(org);
  if (!domains.length) return "Verify an email domain in HealthFlow before provisioning users.";
  if (!domains.includes(value.split("@")[1])) return "That email domain is not verified for this organization.";
  return null;
}

function applyPatch(db: Database, org: Organization, member: OrganizationMember, user: UserAccount, patch: UserPatch, actor: string): ScimResponse | null {
  if (member.role === "OWNER" && (patch.active === false || (patch.userName && patch.userName.toLowerCase() !== user.email))) {
    return error(400, "Owners cannot be deactivated or renamed through SCIM. Change the owner in HealthFlow first.", "mutability");
  }
  const now = new Date().toISOString();
  if (patch.userName && patch.userName.toLowerCase() !== user.email) {
    const problem = checkEmail(org, patch.userName);
    if (problem) return error(400, problem, "invalidValue");
    if (db.users.some((item) => item.id !== user.id && item.email === patch.userName!.toLowerCase())) return error(409, "Another account uses that email.", "uniqueness");
    user.email = patch.userName.toLowerCase();
    user.updatedAt = now;
  }
  const profile = db.profiles.find((item) => item.id === user.id);
  const name = patch.fullName ?? ([patch.givenName, patch.familyName].filter(Boolean).join(" ") || undefined);
  if (profile && name) {
    profile.fullName = name.slice(0, 120);
    profile.updatedAt = now;
  }
  if (patch.externalId !== undefined) member.scimExternalId = patch.externalId;
  if (patch.active !== undefined) {
    const wasActive = member.status === "ACTIVE";
    member.status = patch.active ? "ACTIVE" : "SUSPENDED";
    if (wasActive && !patch.active) {
      user.sessionVersion += 1;
      pushAudit(db, { organizationId: org.id, actorId: null, event: "scim.user_deactivated", resourceType: "user", resourceId: user.id, metadata: { via: actor } });
    } else if (!wasActive && patch.active) {
      pushAudit(db, { organizationId: org.id, actorId: null, event: "scim.user_reactivated", resourceType: "user", resourceId: user.id, metadata: { via: actor } });
    }
  }
  member.updatedAt = now;
  pushAudit(db, { organizationId: org.id, actorId: null, event: "scim.user_updated", resourceType: "user", resourceId: user.id, metadata: { fields: Object.keys(patch).join(",") } });
  return null;
}

function parseFilter(filter: string | null): { attribute: string; value: string } | null | "unsupported" {
  if (!filter) return null;
  const match = /^\s*(userName|externalId|emails\.value|emails\[type eq "work"\]\.value)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
  if (!match) return "unsupported";
  const attribute = match[1].toLowerCase().startsWith("emails") ? "username" : match[1].toLowerCase();
  return { attribute, value: match[2] };
}

export interface ScimRequest {
  method: string;
  /** Path after /api/scim/v2, e.g. "/Users" or "/Users/abc". */
  path: string;
  query: URLSearchParams;
  authorization: string | null;
  body?: unknown;
}

export function handleScim(request: ScimRequest): ScimResponse {
  const token = /^Bearer\s+(\S+)$/i.exec(request.authorization ?? "")?.[1] ?? "none";
  if (!rateLimit(`scim:${hashToken(token).slice(0, 16)}`, 600, 60_000)) return error(429, "Too many requests.");
  const snapshot = readDb();
  const org = organizationForToken(snapshot, request.authorization);
  if (!org) return error(401, "Invalid or missing bearer token.");

  const segments = request.path.split("/").filter(Boolean);
  const resource = segments[0] ?? "";
  const id = segments[1];

  if (resource === "ServiceProviderConfig" && request.method === "GET") {
    return {
      status: 200,
      body: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Token generated in HealthFlow Settings > Security." }],
      },
    };
  }
  if (resource === "ResourceTypes" && request.method === "GET") {
    return { status: 200, body: { schemas: [LIST_SCHEMA], totalResults: 1, Resources: [{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER_SCHEMA }] } };
  }
  if (resource === "Groups") return error(404, "Groups are not supported. Assign people to the HealthFlow app directly.");
  if (resource !== "Users") return error(404, "Unknown resource.");

  const touch = (db: Database) => {
    const target = db.organizations.find((item) => item.id === org.id);
    if (target?.scim) target.scim.lastUsedAt = new Date().toISOString();
  };

  if (request.method === "GET" && !id) {
    const filter = parseFilter(request.query.get("filter"));
    if (filter === "unsupported") return error(400, "Only 'userName eq', 'externalId eq' and 'emails.value eq' filters are supported.", "invalidFilter");
    const startIndex = Math.max(1, Number(request.query.get("startIndex") ?? "1") || 1);
    const count = Math.min(200, Math.max(0, Number(request.query.get("count") ?? "100") || 0));
    const rows = snapshot.organizationMembers
      .filter((member) => member.organizationId === org.id)
      .map((member) => ({ member, user: snapshot.users.find((item) => item.id === member.userId)! }))
      .filter(({ member, user }) => {
        if (!user || !filter) return Boolean(user);
        if (filter.attribute === "username") return user.email === filter.value.toLowerCase();
        return (member.scimExternalId ?? "") === filter.value;
      });
    mutate(touch);
    return {
      status: 200,
      body: {
        schemas: [LIST_SCHEMA],
        totalResults: rows.length,
        startIndex,
        itemsPerPage: Math.min(count, Math.max(0, rows.length - startIndex + 1)),
        Resources: rows.slice(startIndex - 1, startIndex - 1 + count).map(({ member, user }) => toScimUser(snapshot, org, member, user)),
      },
    };
  }

  if (request.method === "POST" && !id) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const patch = patchFromResource(body);
    if (!patch.userName) return error(400, "userName is required.", "invalidValue");
    const problem = checkEmail(org, patch.userName);
    if (problem) return error(400, problem, "invalidValue");
    return mutate((db) => {
      touch(db);
      const target = requireOrg(db, org.id);
      const email = patch.userName!.toLowerCase();
      const now = new Date().toISOString();
      let user = db.users.find((item) => item.email === email);
      if (user && db.organizationMembers.some((item) => item.organizationId === target.id && item.userId === user!.id)) {
        return error(409, "This user is already provisioned.", "uniqueness");
      }
      if (!user) {
        user = {
          id: randomUUID(),
          email,
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
          fullName: (patch.fullName ?? [patch.givenName, patch.familyName].filter(Boolean).join(" ")) || email.split("@")[0],
          jobTitle: "",
          phone: "",
          onboardingCompleted: true,
          notificationPreferences: { caseAssigned: true, statusChanged: true, taskDue: true, aiComplete: true, emailEnabled: false },
          createdAt: now,
          updatedAt: now,
        });
      }
      const member: OrganizationMember = {
        id: randomUUID(),
        organizationId: target.id,
        userId: user.id,
        role: target.sso?.defaultRole ?? "VIEWER",
        status: patch.active === false ? "SUSPENDED" : "ACTIVE",
        lastActiveAt: null,
        scimExternalId: patch.externalId ?? null,
        createdAt: now,
        updatedAt: now,
        createdBy: user.id,
        updatedBy: null,
      };
      db.organizationMembers.push(member);
      pushAudit(db, { organizationId: target.id, actorId: null, event: "scim.user_created", resourceType: "user", resourceId: user.id, metadata: { role: member.role } });
      return { status: 201, body: toScimUser(db, target, member, user) };
    });
  }

  if (!id) return error(405, "Method not allowed.");

  return mutate((db) => {
    touch(db);
    const target = requireOrg(db, org.id);
    const member = db.organizationMembers.find((item) => item.organizationId === target.id && item.userId === id);
    const user = db.users.find((item) => item.id === id);
    if (!member || !user) return error(404, "User not found.");

    if (request.method === "GET") return { status: 200, body: toScimUser(db, target, member, user) };

    if (request.method === "PUT" || request.method === "PATCH") {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch = request.method === "PATCH" ? patchFromOperations(body) : patchFromResource(body);
      if (!patch) return error(400, `PATCH requests must use the ${PATCH_SCHEMA} format.`, "invalidSyntax");
      if (request.method === "PUT" && patch.active === undefined) patch.active = true;
      const failed = applyPatch(db, target, member, user, patch, request.method);
      if (failed) return failed;
      return { status: 200, body: toScimUser(db, target, member, user) };
    }

    if (request.method === "DELETE") {
      const failed = applyPatch(db, target, member, user, { active: false }, "DELETE");
      if (failed) return failed;
      return { status: 204 };
    }
    return error(405, "Method not allowed.");
  });
}
