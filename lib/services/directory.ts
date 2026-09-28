import { randomUUID } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import type { Payer, Provider, RequestContext } from "@/lib/domain/types";
import { mutate, readDb } from "@/lib/store";
import { pushAudit } from "@/lib/services/events";
import { inOrg, requireInOrg } from "@/lib/services/query";

export function listProviders(ctx: RequestContext) {
  assertCan(ctx.role, "providers.read");
  return inOrg(readDb().providers, ctx.organizationId).sort((a, b) => a.name.localeCompare(b.name));
}

export function listPayers(ctx: RequestContext) {
  assertCan(ctx.role, "payers.read");
  return inOrg(readDb().payers, ctx.organizationId).sort((a, b) => a.name.localeCompare(b.name));
}

export function createProvider(
  ctx: RequestContext,
  input: Omit<Provider, "id" | "organizationId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">,
): Provider {
  assertCan(ctx.role, "providers.write");
  return mutate((db) => {
    const now = new Date().toISOString();
    const provider: Provider = {
      ...input,
      npi: input.npi || "DEMO-NPI-UNSET",
      id: randomUUID(),
      organizationId: ctx.organizationId,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    };
    db.providers.push(provider);
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "provider.created",
      resourceType: "provider",
      resourceId: provider.id,
      metadata: { name: provider.name },
    });
    return provider;
  });
}

export function updateProvider(
  ctx: RequestContext,
  id: string,
  input: Omit<Provider, "id" | "organizationId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">,
): Provider {
  assertCan(ctx.role, "providers.write");
  return mutate((db) => {
    const provider = requireInOrg(db.providers, ctx.organizationId, id);
    Object.assign(provider, input, { updatedAt: new Date().toISOString(), updatedBy: ctx.userId });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "provider.updated",
      resourceType: "provider",
      resourceId: provider.id,
      metadata: { name: provider.name, status: provider.status },
    });
    return provider;
  });
}

export function createPayer(
  ctx: RequestContext,
  input: Omit<Payer, "id" | "organizationId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">,
): Payer {
  assertCan(ctx.role, "payers.write");
  return mutate((db) => {
    const now = new Date().toISOString();
    const payer: Payer = {
      ...input,
      notes: input.notes,
      id: randomUUID(),
      organizationId: ctx.organizationId,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    };
    db.payers.push(payer);
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "payer.created",
      resourceType: "payer",
      resourceId: payer.id,
      metadata: { name: payer.name },
    });
    return payer;
  });
}

export function updatePayer(
  ctx: RequestContext,
  id: string,
  input: Omit<Payer, "id" | "organizationId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">,
): Payer {
  assertCan(ctx.role, "payers.write");
  return mutate((db) => {
    const payer = requireInOrg(db.payers, ctx.organizationId, id);
    Object.assign(payer, input, { updatedAt: new Date().toISOString(), updatedBy: ctx.userId });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "payer.updated",
      resourceType: "payer",
      resourceId: payer.id,
      metadata: { name: payer.name, active: payer.active },
    });
    return payer;
  });
}

export function activeMembers(ctx: RequestContext) {
  const db = readDb();
  return db.organizationMembers
    .filter((member) => member.organizationId === ctx.organizationId && member.status === "ACTIVE")
    .map((member) => ({
      userId: member.userId,
      role: member.role,
      name: db.profiles.find((profile) => profile.id === member.userId)?.fullName ?? "User",
      email: db.users.find((user) => user.id === member.userId)?.email ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
