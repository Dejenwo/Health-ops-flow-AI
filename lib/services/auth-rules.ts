import { randomUUID } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import { validationError } from "@/lib/domain/errors";
import { authRequirement, RULE_CODE_PATTERN } from "@/lib/domain/auth-rules";
import { normalizeCode } from "@/lib/domain/codes";
import type { AuthRequirement, CodeType, PayerAuthRule, RequestContext } from "@/lib/domain/types";
import { mutate, readDb } from "@/lib/store";
import { pushAudit } from "@/lib/services/events";
import { findInOrg, inOrg } from "@/lib/services/query";

export function listAuthRules(ctx: RequestContext, payerId?: string): (PayerAuthRule & { payerName: string })[] {
  assertCan(ctx.role, "payers.read");
  const db = readDb();
  const names = new Map(inOrg(db.payers, ctx.organizationId).map((payer) => [payer.id, payer.name]));
  return inOrg(db.payerAuthRules, ctx.organizationId)
    .filter((rule) => !payerId || rule.payerId === payerId)
    .map((rule) => ({ ...rule, payerName: names.get(rule.payerId) ?? "Payer" }))
    .sort((a, b) => a.payerName.localeCompare(b.payerName) || a.code.localeCompare(b.code));
}

/** Rules for one organization, for client components that check codes as staff type. */
export function rulesForOrganization(ctx: RequestContext): PayerAuthRule[] {
  assertCan(ctx.role, "payers.read");
  return inOrg(readDb().payerAuthRules, ctx.organizationId);
}

export function saveAuthRule(ctx: RequestContext, input: { payerId: string; codeType: CodeType; code: string; requirement: AuthRequirement; note: string }): PayerAuthRule {
  assertCan(ctx.role, "authRules.write");
  const code = normalizeCode(input.code);
  if (!RULE_CODE_PATTERN.test(code)) throw validationError("Enter a code like 72148 or J1745, or a prefix like 7214*.");
  return mutate((db) => {
    if (!findInOrg(db.payers, ctx.organizationId, input.payerId)) throw validationError("Choose a payer in your organization.");
    const now = new Date().toISOString();
    const existing = db.payerAuthRules.find(
      (rule) => rule.organizationId === ctx.organizationId && rule.payerId === input.payerId && rule.codeType === input.codeType && rule.code === code,
    );
    const rule: PayerAuthRule = existing
      ? Object.assign(existing, { requirement: input.requirement, note: input.note.trim().slice(0, 300), updatedAt: now, updatedBy: ctx.userId })
      : {
          id: randomUUID(),
          organizationId: ctx.organizationId,
          payerId: input.payerId,
          codeType: input.codeType,
          code,
          requirement: input.requirement,
          note: input.note.trim().slice(0, 300),
          createdAt: now,
          updatedAt: now,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        };
    if (!existing) db.payerAuthRules.push(rule);
    pushAudit(db, { organizationId: ctx.organizationId, actorId: ctx.userId, event: "auth_rule.saved", resourceType: "payer", resourceId: input.payerId, metadata: { code, codeType: input.codeType, requirement: input.requirement } });
    return rule;
  });
}

export function deleteAuthRule(ctx: RequestContext, id: string): void {
  assertCan(ctx.role, "authRules.write");
  mutate((db) => {
    const rule = findInOrg(db.payerAuthRules, ctx.organizationId, id);
    if (!rule) return;
    db.payerAuthRules = db.payerAuthRules.filter((item) => item.id !== id);
    pushAudit(db, { organizationId: ctx.organizationId, actorId: ctx.userId, event: "auth_rule.deleted", resourceType: "payer", resourceId: rule.payerId, metadata: { code: rule.code, codeType: rule.codeType } });
  });
}

export { authRequirement };
