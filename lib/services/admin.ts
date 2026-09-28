import { randomUUID } from "crypto";
import { assertCan, canAssignRole } from "@/lib/domain/permissions";
import { forbidden, validationError } from "@/lib/domain/errors";
import type { PlanId, RequestContext, Role } from "@/lib/domain/types";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { getPlan } from "@/lib/billing/plans";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { rateLimit } from "@/lib/auth/rate-limit";
import { mutate, readDb } from "@/lib/store";
import { pushAudit } from "@/lib/services/events";
import { inOrg } from "@/lib/services/query";

export function listTeam(ctx: RequestContext) {
  assertCan(ctx.role, "team.read");
  const db = readDb();
  const members = db.organizationMembers
    .filter((member) => member.organizationId === ctx.organizationId)
    .map((member) => ({
      ...member,
      name: db.profiles.find((profile) => profile.id === member.userId)?.fullName ?? "Invited user",
      email: db.users.find((user) => user.id === member.userId)?.email ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const invitations = db.invitations
    .filter((invite) => invite.organizationId === ctx.organizationId && !invite.acceptedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { members, invitations };
}

export function inviteMember(ctx: RequestContext, email: string, role: Role): { token: string } {
  assertCan(ctx.role, "team.invite");
  if (!canAssignRole(ctx.role, role)) throw forbidden("You cannot invite someone into that role.");
  const token = newToken();
  mutate((db) => {
    const existingUser = db.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      const already = db.organizationMembers.find(
        (member) => member.organizationId === ctx.organizationId && member.userId === existingUser.id && member.status === "ACTIVE",
      );
      if (already) throw validationError("That person is already on the team.");
    }
    db.invitations.push({
      id: randomUUID(),
      organizationId: ctx.organizationId,
      email: email.toLowerCase(),
      role,
      tokenHash: hashToken(token),
      invitedBy: ctx.userId,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      acceptedAt: null,
      createdAt: new Date().toISOString(),
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "member.invited",
      resourceType: "invitation",
      resourceId: email.toLowerCase(),
      metadata: { role },
    });
  });
  return { token };
}

export function changeMemberRole(ctx: RequestContext, memberId: string, role: Role): void {
  assertCan(ctx.role, "team.role.change");
  if (!canAssignRole(ctx.role, role)) throw forbidden("You cannot assign that role.");
  mutate((db) => {
    const member = db.organizationMembers.find((item) => item.id === memberId && item.organizationId === ctx.organizationId);
    if (!member) throw validationError("Team member not found.");
    if (member.userId === ctx.userId) throw validationError("You cannot change your own role.");
    if (member.role === "OWNER" && ctx.role !== "OWNER") throw forbidden("Only an owner can change another owner.");
    if (member.role === "OWNER" && role !== "OWNER") {
      const owners = db.organizationMembers.filter(
        (item) => item.organizationId === ctx.organizationId && item.role === "OWNER" && item.status === "ACTIVE",
      );
      if (owners.length <= 1) throw validationError("The organization must keep at least one owner.");
    }
    const previous = member.role;
    member.role = role;
    member.updatedAt = new Date().toISOString();
    member.updatedBy = ctx.userId;
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "member.role_changed",
      resourceType: "organization_member",
      resourceId: member.id,
      metadata: { previous, role },
    });
  });
}

export function acceptInvitation(ctx: RequestContext, token: string): { organizationId: string; role: Role } {
  const tokenHash = hashToken(token);
  return mutate((db) => {
    const invite = db.invitations.find((item) => item.tokenHash === tokenHash && !item.acceptedAt);
    if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) {
      throw validationError("This invitation is invalid or expired.");
    }
    if (invite.email.toLowerCase() !== ctx.email.toLowerCase()) {
      throw forbidden("Sign in with the invited email address to accept.");
    }
    const existing = db.organizationMembers.find(
      (member) => member.organizationId === invite.organizationId && member.userId === ctx.userId,
    );
    if (!existing) {
      db.organizationMembers.push({
        id: randomUUID(),
        organizationId: invite.organizationId,
        userId: ctx.userId,
        role: invite.role,
        status: "ACTIVE",
        lastActiveAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: invite.invitedBy,
        updatedBy: ctx.userId,
      });
    } else {
      existing.status = "ACTIVE";
      existing.role = invite.role;
      existing.updatedAt = new Date().toISOString();
    }
    invite.acceptedAt = new Date().toISOString();
    pushAudit(db, {
      organizationId: invite.organizationId,
      actorId: ctx.userId,
      event: "member.joined",
      resourceType: "organization_member",
      resourceId: ctx.userId,
      metadata: { role: invite.role },
    });
    return { organizationId: invite.organizationId, role: invite.role };
  });
}

export function updateProfile(ctx: RequestContext, input: { fullName: string; jobTitle: string; phone: string }) {
  mutate((db) => {
    const profile = db.profiles.find((item) => item.id === ctx.userId);
    if (!profile) throw validationError("Profile not found.");
    profile.fullName = input.fullName;
    profile.jobTitle = input.jobTitle;
    profile.phone = input.phone || "";
    profile.updatedAt = new Date().toISOString();
  });
}

export function updateNotificationPreferences(
  ctx: RequestContext,
  prefs: RequestContext["profile"]["notificationPreferences"],
) {
  mutate((db) => {
    const profile = db.profiles.find((item) => item.id === ctx.userId);
    if (!profile) throw validationError("Profile not found.");
    profile.notificationPreferences = prefs;
    profile.updatedAt = new Date().toISOString();
  });
}

export function updateOrganization(
  ctx: RequestContext,
  input: { name: string; type: RequestContext["organization"]["type"]; specialty: string; providerCount: number },
) {
  assertCan(ctx.role, "org.update");
  mutate((db) => {
    const organization = db.organizations.find((item) => item.id === ctx.organizationId);
    if (!organization) throw validationError("Organization not found.");
    organization.name = input.name;
    organization.type = input.type;
    organization.specialty = input.specialty;
    organization.providerCount = input.providerCount;
    organization.updatedAt = new Date().toISOString();
    organization.updatedBy = ctx.userId;
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "organization.updated",
      resourceType: "organization",
      resourceId: organization.id,
      metadata: { name: organization.name },
    });
  });
}

export function updateOrganizationSecurity(ctx: RequestContext, input: { requireMfa: boolean; idleTimeoutMinutes: number }) {
  assertCan(ctx.role, "settings.security");
  mutate((db) => {
    const organization = db.organizations.find((item) => item.id === ctx.organizationId);
    if (!organization) throw validationError("Organization not found.");
    const turningOn = input.requireMfa && !organization.security.requireMfa;
    organization.security = { requireMfa: input.requireMfa, idleTimeoutMinutes: input.idleTimeoutMinutes };
    organization.updatedAt = new Date().toISOString();
    organization.updatedBy = ctx.userId;
    if (turningOn) {
      // Members without MFA are signed out so their next sign-in routes them to enrollment.
      const memberIds = new Set(
        db.organizationMembers.filter((item) => item.organizationId === ctx.organizationId).map((item) => item.userId),
      );
      for (const user of db.users) {
        if (memberIds.has(user.id) && !user.mfaEnabled) user.sessionVersion += 1;
      }
    }
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "organization.security_updated",
      resourceType: "organization",
      resourceId: organization.id,
      metadata: { requireMfa: input.requireMfa, idleTimeoutMinutes: input.idleTimeoutMinutes },
    });
  });
}

export function completeOnboarding(
  ctx: RequestContext,
  input: {
    organizationName: string;
    organizationType: RequestContext["organization"]["type"];
    specialty: string;
    providerCount: number;
    fullName: string;
    jobTitle: string;
    phone: string;
    workflows: RequestContext["organization"]["workflows"];
  },
) {
  if (ctx.role !== "OWNER" && ctx.role !== "ADMIN") {
    throw forbidden();
  }
  mutate((db) => {
    const organization = db.organizations.find((item) => item.id === ctx.organizationId);
    const profile = db.profiles.find((item) => item.id === ctx.userId);
    if (!organization || !profile) throw validationError("Account setup is incomplete.");
    organization.name = input.organizationName;
    organization.type = input.organizationType;
    organization.specialty = input.specialty;
    organization.providerCount = input.providerCount;
    organization.workflows = { ...input.workflows, priorAuthorization: true };
    organization.updatedAt = new Date().toISOString();
    organization.updatedBy = ctx.userId;
    profile.fullName = input.fullName;
    profile.jobTitle = input.jobTitle;
    profile.phone = input.phone;
    profile.onboardingCompleted = true;
    profile.updatedAt = organization.updatedAt;
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "organization.onboarded",
      resourceType: "organization",
      resourceId: organization.id,
      metadata: { name: organization.name },
    });
  });
}

export function listAudit(ctx: RequestContext) {
  assertCan(ctx.role, "audit.read");
  const db = readDb();
  const names = new Map(db.profiles.map((profile) => [profile.id, profile.fullName]));
  return inOrg(db.auditEvents, ctx.organizationId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 200)
    .map((event) => ({ ...event, actorName: event.actorId ? names.get(event.actorId) ?? "User" : "System" }));
}

export function getSubscription(ctx: RequestContext) {
  assertCan(ctx.role, "billing.read");
  const subscription = readDb().subscriptions.find((item) => item.organizationId === ctx.organizationId);
  return {
    subscription: subscription ?? null,
    plan: getPlan(subscription?.plan ?? "STARTER"),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  };
}

export function changePlan(ctx: RequestContext, plan: PlanId) {
  assertCan(ctx.role, "billing.manage");
  getPlan(plan);
  return mutate((db) => {
    const subscription = db.subscriptions.find((item) => item.organizationId === ctx.organizationId);
    if (!subscription) throw validationError("No subscription exists for this organization.");
    subscription.plan = plan;
    subscription.status = "DEMO";
    subscription.updatedAt = new Date().toISOString();
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "billing.plan_changed",
      resourceType: "subscription",
      resourceId: subscription.id,
      metadata: { plan, mode: "demo" },
    });
    return { mode: "demo" as const, plan };
  });
}

export function listIntegrationCards(ctx: RequestContext) {
  const connections = inOrg(readDb().integrationConnections, ctx.organizationId);
  return INTEGRATIONS.map((item) => {
    const connection = connections.find((row) => row.providerKey === item.key);
    return {
      ...item,
      requestStatus: connection?.status ?? null,
    };
  });
}

export function requestIntegration(ctx: RequestContext, providerKey: string) {
  assertCan(ctx.role, "integrations.manage");
  const definition = INTEGRATIONS.find((item) => item.key === providerKey);
  if (!definition) throw validationError("Unknown integration.");
  mutate((db) => {
    const existing = db.integrationConnections.find(
      (item) => item.organizationId === ctx.organizationId && item.providerKey === providerKey,
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.status = "REQUESTED";
      existing.requestedAt = now;
      existing.requestedBy = ctx.userId;
      existing.updatedAt = now;
    } else {
      db.integrationConnections.push({
        id: randomUUID(),
        organizationId: ctx.organizationId,
        providerKey,
        status: "REQUESTED",
        requestedAt: now,
        requestedBy: ctx.userId,
        notes: "Interest recorded. No live connection was created.",
        createdAt: now,
        updatedAt: now,
      });
    }
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "integration.requested",
      resourceType: "integration",
      resourceId: providerKey,
      metadata: { provider: definition.name },
    });
  });
}

export function submitContact(input: { name: string; email: string; organization: string; message: string }) {
  if (!rateLimit(`contact:${input.email.toLowerCase()}`, 5, 60 * 60 * 1000)) {
    throw validationError("Too many messages. Try again later.");
  }
  mutate((db) => {
    db.contactRequests.push({
      id: randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
    });
  });
}
