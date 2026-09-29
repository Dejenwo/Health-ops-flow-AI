import { randomUUID } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import { validationError } from "@/lib/domain/errors";
import { isValidNpi } from "@/lib/domain/codes";
import type { ClearinghouseProvider, Database, EligibilityCheck, IntegrationEndpoint, RequestContext } from "@/lib/domain/types";
import { IntegrationError, type ClearinghouseAdapter } from "@/lib/integrations/eligibility";
import { SimulatorAdapter } from "@/lib/integrations/simulator";
import { StediAdapter } from "@/lib/integrations/stedi";
import { openSecret, sealSecret } from "@/lib/security/crypto";
import { mutate, readDb } from "@/lib/store";
import { pushActivity, pushAudit } from "@/lib/services/events";
import { findInOrg, inOrg } from "@/lib/services/query";

/**
 * Integration hub. Owns connections to outside systems, runs requests through vendor adapters,
 * and records a metadata-only message log (never payloads, so PHI does not pile up in logs).
 */

export const MAX_MESSAGES_KEPT = 500;

let adapterOverride: ((endpoint: IntegrationEndpoint) => ClearinghouseAdapter) | null = null;
/** Tests replace the adapter factory. */
export function setAdapterFactoryForTests(factory: typeof adapterOverride) {
  adapterOverride = factory;
}

function adapterFor(endpoint: IntegrationEndpoint): ClearinghouseAdapter {
  if (adapterOverride) return adapterOverride(endpoint);
  if (endpoint.provider === "simulator") return new SimulatorAdapter();
  if (!endpoint.secretEncrypted) throw validationError("The clearinghouse API key is missing. Add it in Integrations.");
  return new StediAdapter(openSecret(endpoint.secretEncrypted));
}

function clearinghouse(db: Database, organizationId: string): IntegrationEndpoint | null {
  return db.integrationEndpoints.find((item) => item.organizationId === organizationId && item.kind === "clearinghouse") ?? null;
}

export function getIntegrationOverview(ctx: RequestContext) {
  assertCan(ctx.role, "integrations.manage");
  const db = readDb();
  const endpoint = clearinghouse(db, ctx.organizationId);
  return {
    clearinghouse: endpoint
      ? { ...endpoint, secretEncrypted: undefined, hasSecret: Boolean(endpoint.secretEncrypted) }
      : null,
    messages: inOrg(db.integrationMessages, ctx.organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 25),
  };
}

/** Whether staff can run an eligibility check (shown as a button on the case). */
export function eligibilityAvailable(ctx: RequestContext): boolean {
  const endpoint = clearinghouse(readDb(), ctx.organizationId);
  return Boolean(endpoint?.enabled);
}

export function saveClearinghouse(
  ctx: RequestContext,
  input: { provider: ClearinghouseProvider; environment: "test" | "production"; apiKey: string; enabled: boolean },
): void {
  assertCan(ctx.role, "integrations.manage");
  mutate((db) => {
    const now = new Date().toISOString();
    let endpoint = clearinghouse(db, ctx.organizationId);
    const secret = input.apiKey.trim() ? sealSecret(input.apiKey.trim()) : endpoint?.provider === input.provider ? endpoint.secretEncrypted : null;
    if (input.provider !== "simulator" && input.enabled && !secret) throw validationError("Enter the API key from your clearinghouse account.");
    if (!endpoint) {
      endpoint = {
        id: randomUUID(),
        organizationId: ctx.organizationId,
        kind: "clearinghouse",
        provider: input.provider,
        environment: input.environment,
        secretEncrypted: secret,
        enabled: input.enabled,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: "",
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      };
      db.integrationEndpoints.push(endpoint);
    } else {
      Object.assign(endpoint, { provider: input.provider, environment: input.environment, secretEncrypted: secret, enabled: input.enabled, updatedAt: now, updatedBy: ctx.userId });
    }
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "integration.clearinghouse_saved",
      resourceType: "integration",
      resourceId: endpoint.id,
      metadata: { provider: input.provider, environment: input.environment, enabled: input.enabled, keyChanged: Boolean(input.apiKey.trim()) },
    });
  });
}

function logMessage(
  db: Database,
  input: { organizationId: string; endpoint: IntegrationEndpoint | null; operation: string; outcome: "SUCCESS" | "FAILED"; httpStatus: number | null; attempts: number; durationMs: number; traceId: string; error: string },
) {
  db.integrationMessages.push({
    id: randomUUID(),
    organizationId: input.organizationId,
    endpointId: input.endpoint?.id ?? null,
    provider: input.endpoint?.provider ?? "none",
    operation: input.operation,
    direction: "OUTBOUND",
    outcome: input.outcome,
    httpStatus: input.httpStatus,
    attempts: input.attempts,
    durationMs: input.durationMs,
    traceId: input.traceId,
    error: input.error.slice(0, 300),
    createdAt: new Date().toISOString(),
  });
  // Keep the log bounded per organization.
  const mine = db.integrationMessages.filter((item) => item.organizationId === input.organizationId);
  if (mine.length > MAX_MESSAGES_KEPT) {
    const drop = new Set(mine.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).slice(0, mine.length - MAX_MESSAGES_KEPT).map((item) => item.id));
    db.integrationMessages = db.integrationMessages.filter((item) => !drop.has(item.id));
  }
  if (input.endpoint) {
    const target = db.integrationEndpoints.find((item) => item.id === input.endpoint!.id);
    if (target) {
      if (input.outcome === "SUCCESS") target.lastSuccessAt = new Date().toISOString();
      else {
        target.lastErrorAt = new Date().toISOString();
        target.lastError = input.error.slice(0, 300);
      }
    }
  }
}

export async function testClearinghouse(ctx: RequestContext): Promise<{ ok: boolean; message: string }> {
  assertCan(ctx.role, "integrations.manage");
  const endpoint = clearinghouse(readDb(), ctx.organizationId);
  if (!endpoint) throw validationError("Save the clearinghouse settings first.");
  const started = Date.now();
  try {
    await adapterFor(endpoint).testConnection();
    mutate((db) => logMessage(db, { organizationId: ctx.organizationId, endpoint, operation: "test_connection", outcome: "SUCCESS", httpStatus: 200, attempts: 1, durationMs: Date.now() - started, traceId: "", error: "" }));
    return { ok: true, message: "Connected. The clearinghouse accepted the API key." };
  } catch (error) {
    const failure = error instanceof IntegrationError ? error : new IntegrationError(error instanceof Error ? error.message : "Connection failed.", null, false);
    mutate((db) => logMessage(db, { organizationId: ctx.organizationId, endpoint, operation: "test_connection", outcome: "FAILED", httpStatus: failure.httpStatus, attempts: failure.attempts, durationMs: Date.now() - started, traceId: "", error: failure.message }));
    return { ok: false, message: failure.message };
  }
}

/**
 * Runs an eligibility check for the case's patient, payer and ordering provider, and stores the
 * result on the case. Prerequisites are checked first so staff get a plain explanation instead
 * of a clearinghouse error.
 */
export async function runEligibilityCheck(ctx: RequestContext, authorizationId: string): Promise<EligibilityCheck> {
  assertCan(ctx.role, "authorizations.write");
  const db = readDb();
  const endpoint = clearinghouse(db, ctx.organizationId);
  if (!endpoint?.enabled) throw validationError("Eligibility checks are not set up. An admin can connect a clearinghouse in Integrations.");
  const authorization = findInOrg(db.authorizationCases, ctx.organizationId, authorizationId);
  if (!authorization) throw validationError("Case not found.");
  const patient = findInOrg(db.patients, ctx.organizationId, authorization.patientId);
  const payer = findInOrg(db.payers, ctx.organizationId, authorization.payerId);
  const provider = findInOrg(db.providers, ctx.organizationId, authorization.providerId);
  const problems: string[] = [];
  if (!patient) problems.push("patient");
  if (!payer?.identifier) problems.push("the payer's electronic Payer ID (edit the payer)");
  if (!provider || !isValidNpi(provider.npi)) problems.push("a valid NPI on the ordering provider");
  if (!authorization.memberId.trim()) problems.push("the member ID");
  if (problems.length) throw validationError(`Add ${problems.join(", ")} before checking eligibility.`);

  const started = Date.now();
  const base = {
    id: randomUUID(),
    organizationId: ctx.organizationId,
    patientId: patient!.id,
    payerId: payer!.id,
    authorizationId: authorization.id,
    provider: endpoint.provider,
    environment: endpoint.environment,
    checkedAt: new Date().toISOString(),
    checkedBy: ctx.userId,
  };
  let check: EligibilityCheck;
  let log: Parameters<typeof logMessage>[1];
  try {
    const result = await adapterFor(endpoint).checkEligibility({
      payerId: payer!.identifier,
      provider: { npi: provider!.npi, organizationName: ctx.organization.name },
      subscriber: { firstName: patient!.firstName, lastName: patient!.lastName, dateOfBirth: patient!.dateOfBirth, memberId: authorization.memberId.trim() },
      serviceTypeCodes: ["30"],
      dateOfService: authorization.requestedServiceDate,
    });
    check = { ...base, status: result.status, planName: result.planName, coverageStart: result.coverageStart, coverageEnd: result.coverageEnd, authIndicator: result.authIndicator, notes: result.notes, errorMessage: "", traceId: result.traceId };
    log = { organizationId: ctx.organizationId, endpoint, operation: "eligibility", outcome: "SUCCESS", httpStatus: result.httpStatus, attempts: result.attempts, durationMs: Date.now() - started, traceId: result.traceId, error: "" };
  } catch (error) {
    const failure = error instanceof IntegrationError ? error : new IntegrationError(error instanceof Error ? error.message : "Eligibility check failed.", null, false);
    check = { ...base, status: "ERROR", planName: "", coverageStart: null, coverageEnd: null, authIndicator: "UNKNOWN", notes: [], errorMessage: failure.message, traceId: "" };
    log = { organizationId: ctx.organizationId, endpoint, operation: "eligibility", outcome: "FAILED", httpStatus: failure.httpStatus, attempts: failure.attempts, durationMs: Date.now() - started, traceId: "", error: failure.message };
  }
  mutate((draft) => {
    draft.eligibilityChecks.push(check);
    logMessage(draft, log);
    pushActivity(draft, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "eligibility.checked",
      summary: check.status === "ERROR" ? `Eligibility check failed for ${authorization.authorizationNumber}` : `Eligibility checked for ${authorization.authorizationNumber}: coverage ${check.status.toLowerCase()}`,
      resourceType: "authorization",
      resourceId: authorization.id,
      authorizationId: authorization.id,
      patientId: authorization.patientId,
    });
    pushAudit(draft, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "integration.eligibility_checked",
      resourceType: "authorization",
      resourceId: authorization.id,
      metadata: { authorizationId: authorization.id, provider: endpoint.provider, environment: endpoint.environment, status: check.status, traceId: check.traceId },
    });
  });
  return check;
}

export function eligibilityHistory(ctx: RequestContext, authorizationId: string): EligibilityCheck[] {
  assertCan(ctx.role, "authorizations.read");
  return inOrg(readDb().eligibilityChecks, ctx.organizationId)
    .filter((item) => item.authorizationId === authorizationId)
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1))
    .slice(0, 10);
}
