import { randomUUID } from "crypto";
import { assertCan, can, roleRank } from "@/lib/domain/permissions";
import {
  assertTransition,
  AWAITING_PAYER,
  DECISION_STATUSES,
  isLocked,
  READINESS_GATED,
  TERMINAL_STATUSES,
} from "@/lib/domain/transitions";
import { validationError } from "@/lib/domain/errors";
import { normalizeCode } from "@/lib/domain/codes";
import { readinessChecklist, readinessGaps } from "@/lib/domain/readiness";
import { caseAlerts, computeAppealDeadline, computeAppealDueAt, computePayerDueAt, serviceDateInWindow, topSeverity } from "@/lib/domain/sla";
import type {
  AuthStatus,
  AuthorizationCase,
  AuthorizationLine,
  Database,
  DecisionOutcome,
  DenialReason,
  DiagnosisEntry,
  LineDecision,
  PeerToPeerStatus,
  Priority,
  RequestContext,
  ReviewType,
  SiteOfCare,
  UnitType,
  CodeType,
} from "@/lib/domain/types";
import { daysBetween, todayISO } from "@/lib/format";
import { mutate, readDb } from "@/lib/store";
import { notifyRoles, pushAccess, pushActivity, pushAudit, pushNotification } from "@/lib/services/events";
import { compareValues, emptyToNull, findInOrg, inOrg, paginate, requireInOrg } from "@/lib/services/query";

export interface AuthorizationQuery {
  q?: string;
  status?: string;
  payerId?: string;
  priority?: string;
  assigneeId?: string;
  alert?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: "updatedAt" | "createdAt" | "priority" | "status" | "requestedServiceDate" | "authorizationNumber" | "payerDueAt";
  dir?: "asc" | "desc";
}

const SORTS = new Set(["updatedAt", "createdAt", "priority", "status", "requestedServiceDate", "authorizationNumber", "payerDueAt"]);

export function listAuthorizations(ctx: RequestContext, query: AuthorizationQuery = {}, now = new Date()) {
  assertCan(ctx.role, "authorizations.read");
  const db = readDb();
  const q = query.q?.trim().toLowerCase() ?? "";
  let rows = inOrg(db.authorizationCases, ctx.organizationId).filter((item) => {
    if (query.status && item.status !== query.status) return false;
    if (query.payerId && item.payerId !== query.payerId) return false;
    if (query.priority && item.priority !== query.priority) return false;
    if (query.assigneeId === "unassigned" && item.assignedUserId) return false;
    if (query.assigneeId && query.assigneeId !== "unassigned" && item.assignedUserId !== query.assigneeId) return false;
    if (query.from && item.requestedServiceDate < query.from) return false;
    if (query.to && item.requestedServiceDate > query.to) return false;
    if (query.alert && !caseAlerts(item, now).some((alert) => alert.kind === query.alert)) return false;
    if (!q) return true;
    const patient = findInOrg(db.patients, ctx.organizationId, item.patientId);
    const payer = findInOrg(db.payers, ctx.organizationId, item.payerId);
    const codes = item.lines.map((line) => `${line.code} ${line.description}`).join(" ");
    const dx = item.diagnoses.map((entry) => `${entry.code} ${entry.description}`).join(" ");
    const haystack = `${item.authorizationNumber} ${item.procedure} ${codes} ${dx} ${item.payerReference} ${patient?.firstName ?? ""} ${patient?.lastName ?? ""} ${patient?.mrn ?? ""} ${payer?.name ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
  const sort = query.sort && SORTS.has(query.sort) ? query.sort : "updatedAt";
  const dir = query.dir === "asc" ? 1 : -1;
  const priorityRank: Record<Priority, number> = { LOW: 1, NORMAL: 2, HIGH: 3, URGENT: 4 };
  rows = rows.sort((a, b) => {
    const left = sort === "priority" ? priorityRank[a.priority] : a[sort];
    const right = sort === "priority" ? priorityRank[b.priority] : b[sort];
    return compareValues(left, right) * dir;
  });
  const page = paginate(rows, query.page, query.pageSize ?? 15);
  return {
    ...page,
    items: page.items.map((item) => decorate(db, ctx.organizationId, item, now)),
  };
}

function decorate(db: Database, organizationId: string, item: AuthorizationCase, now = new Date()) {
  const patient = findInOrg(db.patients, organizationId, item.patientId);
  const payer = findInOrg(db.payers, organizationId, item.payerId);
  const provider = findInOrg(db.providers, organizationId, item.providerId);
  const rendering = item.renderingProviderId ? findInOrg(db.providers, organizationId, item.renderingProviderId) : null;
  const assignee = item.assignedUserId ? db.profiles.find((profile) => profile.id === item.assignedUserId) : null;
  const alerts = caseAlerts(item, now);
  return {
    ...item,
    patientName: patient ? `${patient.lastName}, ${patient.firstName}` : "Unknown patient",
    patientMrn: patient?.mrn ?? "",
    payerName: payer?.name ?? "Unknown payer",
    providerName: provider?.name ?? "Unknown provider",
    renderingProviderName: rendering?.name ?? null,
    assigneeName: assignee?.fullName ?? "Unassigned",
    ageDays: daysBetween(item.createdAt, now),
    codesSummary: item.lines.map((line) => line.code).join(", "),
    primaryDiagnosis: item.diagnoses[0] ?? null,
    alerts,
    alertLevel: topSeverity(alerts),
  };
}

export type DecoratedAuthorization = ReturnType<typeof decorate>;

/** Pure read. Pages that show the workspace must also call `recordAuthorizationView`. */
export function getAuthorizationWorkspace(ctx: RequestContext, id: string, now = new Date()) {
  assertCan(ctx.role, "authorizations.read");
  const db = readDb();
  const authorization = findInOrg(db.authorizationCases, ctx.organizationId, id);
  if (!authorization) return null;
  const names = new Map(db.profiles.map((profile) => [profile.id, profile.fullName]));
  const provider = findInOrg(db.providers, ctx.organizationId, authorization.providerId);
  const payer = findInOrg(db.payers, ctx.organizationId, authorization.payerId);
  const documents = inOrg(db.authorizationDocuments, ctx.organizationId)
    .filter((item) => item.authorizationId === id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const readiness = readinessChecklist({ authorization, orderingProvider: provider, payer, documents });
  const supersededBy = inOrg(db.authorizationCases, ctx.organizationId).find((item) => item.supersedesId === id) ?? null;
  const supersedes = authorization.supersedesId ? findInOrg(db.authorizationCases, ctx.organizationId, authorization.supersedesId) : null;
  return {
    authorization: decorate(db, ctx.organizationId, authorization, now),
    patient: findInOrg(db.patients, ctx.organizationId, authorization.patientId),
    provider,
    renderingProvider: authorization.renderingProviderId
      ? findInOrg(db.providers, ctx.organizationId, authorization.renderingProviderId)
      : null,
    payer,
    documents,
    readiness,
    locked: isLocked(authorization.status),
    supersededBy: supersededBy ? { id: supersededBy.id, authorizationNumber: supersededBy.authorizationNumber } : null,
    supersedes: supersedes ? { id: supersedes.id, authorizationNumber: supersedes.authorizationNumber } : null,
    notes: inOrg(db.caseNotes, ctx.organizationId)
      .filter((item) => item.authorizationId === id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((note) => ({ ...note, authorName: names.get(note.authorId) ?? "User" })),
    tasks: inOrg(db.tasks, ctx.organizationId)
      .filter((item) => item.authorizationId === id)
      .sort((a, b) => ((a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1)),
    activity: inOrg(db.activityEvents, ctx.organizationId)
      .filter((item) => item.authorizationId === id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((item) => ({ ...item, actorName: item.actorId ? names.get(item.actorId) ?? "User" : "System" })),
    history: inOrg(db.authorizationStatusHistory, ctx.organizationId)
      .filter((item) => item.authorizationId === id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((item) => ({ ...item, actorName: names.get(item.changedBy) ?? "User" })),
    aiRuns: inOrg(db.aiRuns, ctx.organizationId)
      .filter((item) => item.authorizationId === id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    audit: can(ctx.role, "audit.read")
      ? inOrg(db.auditEvents, ctx.organizationId)
          .filter((item) => item.resourceId === id || item.metadata?.authorizationId === id)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, 200)
          .map((item) => ({ ...item, actorName: item.actorId ? names.get(item.actorId) ?? "User" : "System" }))
      : [],
  };
}

export function recordAuthorizationView(ctx: RequestContext, id: string): void {
  mutate((db) => {
    const item = findInOrg(db.authorizationCases, ctx.organizationId, id);
    if (!item) return;
    pushAccess(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      resourceType: "authorization",
      resourceId: id,
      metadata: { authorizationNumber: item.authorizationNumber, patientId: item.patientId },
    });
  });
}

export interface LineInput {
  id?: string;
  codeType: CodeType;
  code: string;
  modifiers: string[];
  description: string;
  requestedUnits: number;
  unitType: UnitType;
}

export interface AuthInput {
  patientId: string;
  providerId: string;
  renderingProviderId: string | null;
  payerId: string;
  memberId: string;
  groupNumber: string;
  procedure: string;
  lines: LineInput[];
  diagnoses: DiagnosisEntry[];
  placeOfService: string;
  siteOfCare: SiteOfCare;
  facilityName: string;
  requestedServiceDate: string;
  priority: Priority;
  reviewType: ReviewType;
  clinicalReason: string;
  assignedUserId: string | null;
  internalNotes: string;
}


function assertRelations(db: Database, ctx: RequestContext, input: AuthInput) {
  if (!findInOrg(db.patients, ctx.organizationId, input.patientId)) throw validationError("Choose a patient in your organization.");
  if (!findInOrg(db.providers, ctx.organizationId, input.providerId)) throw validationError("Choose an ordering provider in your organization.");
  if (input.renderingProviderId && !findInOrg(db.providers, ctx.organizationId, input.renderingProviderId)) {
    throw validationError("Choose a rendering provider in your organization.");
  }
  if (!findInOrg(db.payers, ctx.organizationId, input.payerId)) throw validationError("Choose a payer in your organization.");
  if (input.assignedUserId) assertActiveMember(db, ctx, input.assignedUserId);
}

function assertActiveMember(db: Database, ctx: RequestContext, userId: string) {
  const member = db.organizationMembers.find(
    (item) => item.organizationId === ctx.organizationId && item.userId === userId && item.status === "ACTIVE",
  );
  if (!member) throw validationError("Assignee must be an active member of your organization.");
}

function normalizeLines(lines: LineInput[], existing: AuthorizationLine[] = []): AuthorizationLine[] {
  const keep = new Map(existing.map((line) => [line.id, line]));
  return lines.map((line) => {
    const prior = line.id ? keep.get(line.id) : undefined;
    return {
      id: prior?.id ?? randomUUID(),
      codeType: line.codeType,
      code: normalizeCode(line.code),
      modifiers: line.modifiers.map(normalizeCode).filter(Boolean).slice(0, 4),
      description: line.description.trim(),
      requestedUnits: line.requestedUnits,
      unitType: line.unitType,
      approvedUnits: null,
      decision: "PENDING" as LineDecision,
    };
  });
}

function normalizeDiagnoses(entries: DiagnosisEntry[]): DiagnosisEntry[] {
  const seen = new Set<string>();
  const out: DiagnosisEntry[] = [];
  for (const entry of entries) {
    const code = normalizeCode(entry.code);
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, description: entry.description.trim() });
  }
  return out;
}

/** Issues the next case number from the organization's own counter. Never reused, never derived from row counts. */
function nextCaseNumber(db: Database, organizationId: string, now: Date): string {
  const organization = db.organizations.find((item) => item.id === organizationId);
  if (!organization) throw validationError("Organization not found.");
  const taken = new Set(inOrg(db.authorizationCases, organizationId).map((item) => item.authorizationNumber));
  let candidate = "";
  do {
    organization.caseSequence += 1;
    candidate = `PA-${now.getUTCFullYear()}-${String(organization.caseSequence).padStart(5, "0")}`;
  } while (taken.has(candidate));
  return candidate;
}

export function createAuthorization(ctx: RequestContext, input: AuthInput, options: { supersedesId?: string } = {}): AuthorizationCase {
  assertCan(ctx.role, "authorizations.write");
  return mutate((db) => createInDb(db, ctx, input, options));
}

function createInDb(db: Database, ctx: RequestContext, input: AuthInput, options: { supersedesId?: string }): AuthorizationCase {
  assertRelations(db, ctx, input);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const authorization: AuthorizationCase = {
    id: randomUUID(),
    organizationId: ctx.organizationId,
    authorizationNumber: nextCaseNumber(db, ctx.organizationId, nowDate),
    patientId: input.patientId,
    providerId: input.providerId,
    renderingProviderId: input.renderingProviderId || null,
    payerId: input.payerId,
    memberId: input.memberId.trim(),
    groupNumber: input.groupNumber.trim(),
    procedure: input.procedure.trim(),
    lines: normalizeLines(input.lines),
    diagnoses: normalizeDiagnoses(input.diagnoses),
    placeOfService: input.placeOfService,
    siteOfCare: input.siteOfCare,
    facilityName: input.facilityName.trim(),
    requestedServiceDate: input.requestedServiceDate,
    priority: input.priority,
    reviewType: input.reviewType,
    clinicalReason: input.clinicalReason.trim(),
    status: "DRAFT",
    assignedUserId: emptyToNull(input.assignedUserId),
    submissionDate: null,
    payerDueAt: null,
    decisionDate: null,
    decisionOutcome: null,
    validFrom: null,
    validTo: null,
    denialReason: null,
    denialDetail: "",
    determinationDocumentId: null,
    appealDeadline: null,
    appealSubmittedAt: null,
    peerToPeerStatus: "NOT_REQUESTED",
    peerToPeerAt: null,
    peerToPeerNotes: "",
    closedReason: "",
    supersedesId: options.supersedesId ?? null,
    payerReference: "",
    internalNotes: input.internalNotes.trim(),
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };
  db.authorizationCases.push(authorization);
  db.authorizationStatusHistory.push({
    id: randomUUID(),
    organizationId: ctx.organizationId,
    authorizationId: authorization.id,
    previousStatus: null,
    newStatus: "DRAFT",
    changedBy: ctx.userId,
    reason: options.supersedesId ? "Case created to replace an earlier request." : "Case created.",
    createdAt: now,
  });
  pushActivity(db, {
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    type: "authorization.created",
    summary: `Opened ${authorization.authorizationNumber}`,
    resourceType: "authorization",
    resourceId: authorization.id,
    authorizationId: authorization.id,
    patientId: authorization.patientId,
  });
  pushAudit(db, {
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    event: "authorization.created",
    resourceType: "authorization",
    resourceId: authorization.id,
    metadata: {
      authorizationNumber: authorization.authorizationNumber,
      lineCount: authorization.lines.length,
      supersedesId: authorization.supersedesId,
    },
  });
  if (authorization.assignedUserId && authorization.assignedUserId !== ctx.userId) {
    pushNotification(db, {
      organizationId: ctx.organizationId,
      userId: authorization.assignedUserId,
      type: "CASE_ASSIGNED",
      title: "Case assigned to you",
      body: `${authorization.authorizationNumber} was assigned to you.`,
      href: `/authorizations/${authorization.id}`,
    });
  }
  return authorization;
}

function changedFields(current: AuthorizationCase, next: Partial<AuthorizationCase>): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const before = (current as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) changed.push(key);
  }
  return changed;
}

export function updateAuthorization(ctx: RequestContext, id: string, input: AuthInput): AuthorizationCase {
  assertCan(ctx.role, "authorizations.write");
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    if (isLocked(current.status)) {
      throw validationError(
        "This request has been submitted, so its contents are locked. Use Reschedule for a date change, or start a replacement request.",
      );
    }
    const nextAssignee = can(ctx.role, "authorizations.assign") ? emptyToNull(input.assignedUserId) : current.assignedUserId;
    assertRelations(db, ctx, { ...input, assignedUserId: nextAssignee });
    const next: Partial<AuthorizationCase> = {
      patientId: input.patientId,
      providerId: input.providerId,
      renderingProviderId: input.renderingProviderId || null,
      payerId: input.payerId,
      memberId: input.memberId.trim(),
      groupNumber: input.groupNumber.trim(),
      procedure: input.procedure.trim(),
      lines: normalizeLines(input.lines, current.lines),
      diagnoses: normalizeDiagnoses(input.diagnoses),
      placeOfService: input.placeOfService,
      siteOfCare: input.siteOfCare,
      facilityName: input.facilityName.trim(),
      requestedServiceDate: input.requestedServiceDate,
      priority: input.priority,
      reviewType: input.reviewType,
      clinicalReason: input.clinicalReason.trim(),
      assignedUserId: nextAssignee,
      internalNotes: input.internalNotes.trim(),
    };
    const changed = changedFields(current, next);
    if (changed.length === 0) return current;
    const previousAssignee = current.assignedUserId;
    Object.assign(current, next, { updatedAt: new Date().toISOString(), updatedBy: ctx.userId });
    if (previousAssignee !== current.assignedUserId) {
      pushActivity(db, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        type: "authorization.assignment_changed",
        summary: `${current.authorizationNumber} assignment updated`,
        resourceType: "authorization",
        resourceId: current.id,
        authorizationId: current.id,
        patientId: current.patientId,
      });
    }
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "authorization.updated",
      summary: `Updated ${current.authorizationNumber}: ${changed.join(", ")}`,
      resourceType: "authorization",
      resourceId: current.id,
      authorizationId: current.id,
      patientId: current.patientId,
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.updated",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: { authorizationNumber: current.authorizationNumber, changedFields: changed.join(",") },
    });
    return current;
  });
}

function pushStatusHistory(db: Database, ctx: RequestContext, current: AuthorizationCase, previous: AuthStatus, status: AuthStatus, reason: string, now: string) {
  db.authorizationStatusHistory.push({
    id: randomUUID(),
    organizationId: ctx.organizationId,
    authorizationId: current.id,
    previousStatus: previous,
    newStatus: status,
    changedBy: ctx.userId,
    reason,
    createdAt: now,
  });
}

function notifyStatus(db: Database, ctx: RequestContext, current: AuthorizationCase, status: AuthStatus, reason: string) {
  const type =
    status === "APPROVED" || status === "PARTIALLY_APPROVED"
      ? "AUTHORIZATION_APPROVED"
      : status === "DENIED"
        ? "AUTHORIZATION_DENIED"
        : status === "ADDITIONAL_INFORMATION_REQUESTED"
          ? "ADDITIONAL_INFORMATION_REQUESTED"
          : "STATUS_CHANGED";
  if (current.assignedUserId && current.assignedUserId !== ctx.userId) {
    pushNotification(db, {
      organizationId: ctx.organizationId,
      userId: current.assignedUserId,
      type,
      title: `${current.authorizationNumber} is now ${status.replaceAll("_", " ").toLowerCase()}`,
      body: reason,
      href: `/authorizations/${current.id}`,
    });
  }
  if (DECISION_STATUSES.has(status)) {
    notifyRoles(db, ctx.organizationId, ["OWNER", "ADMIN", "MANAGER"], ctx.userId, {
      type,
      title: `${current.authorizationNumber} ${status.replaceAll("_", " ").toLowerCase()}`,
      body: reason,
      href: `/authorizations/${current.id}`,
    });
  }
}

export function transitionAuthorization(ctx: RequestContext, id: string, status: AuthStatus, reason: string, now = new Date()): AuthorizationCase {
  assertCan(ctx.role, "authorizations.transition");
  if (DECISION_STATUSES.has(status)) {
    throw validationError("Payer decisions are recorded with Record decision, which captures the reference number and letter.");
  }
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    assertTransition(current.status, status);
    if (READINESS_GATED.has(status)) {
      const provider = findInOrg(db.providers, ctx.organizationId, current.providerId);
      const payer = findInOrg(db.payers, ctx.organizationId, current.payerId);
      const documents = inOrg(db.authorizationDocuments, ctx.organizationId).filter((item) => item.authorizationId === id);
      const gaps = readinessGaps(readinessChecklist({ authorization: current, orderingProvider: provider, payer, documents }));
      if (gaps.length) throw validationError(`The packet is not ready: ${gaps.join("; ")}.`);
    }
    const payer = requireInOrg(db.payers, ctx.organizationId, current.payerId);
    const previous = current.status;
    const nowIso = now.toISOString();
    let lateAppeal = false;

    if (status === "SUBMITTED") {
      if (!current.submissionDate) current.submissionDate = nowIso;
      // Each submission (including a resubmission after an information request) restarts the payer clock.
      current.payerDueAt = computePayerDueAt(nowIso, current.reviewType, payer);
    }
    if (status === "ADDITIONAL_INFORMATION_REQUESTED") {
      // The payer is waiting on us. Its clock is paused until we resubmit.
      current.payerDueAt = null;
    }
    if (status === "APPEALED") {
      if (current.appealDeadline && todayISO(now) > current.appealDeadline) {
        if (roleRank(ctx.role) < roleRank("MANAGER")) {
          throw validationError("The appeal window has closed. A manager must file a late appeal.");
        }
        lateAppeal = true;
      }
      current.appealSubmittedAt = nowIso;
      current.payerDueAt = computeAppealDueAt(nowIso, current.reviewType, payer);
    }
    if (TERMINAL_STATUSES.has(status)) {
      current.closedReason = reason;
      current.payerDueAt = null;
    }

    current.status = status;
    current.updatedAt = nowIso;
    current.updatedBy = ctx.userId;
    pushStatusHistory(db, ctx, current, previous, status, reason, nowIso);
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "authorization.status_changed",
      summary: `${current.authorizationNumber} moved from ${previous} to ${status}`,
      resourceType: "authorization",
      resourceId: current.id,
      authorizationId: current.id,
      patientId: current.patientId,
      metadata: { previous, status },
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.status_changed",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: { previous, status, authorizationNumber: current.authorizationNumber, lateAppeal },
    });
    notifyStatus(db, ctx, current, status, reason);
    return current;
  });
}

export interface DecisionInput {
  outcome: DecisionOutcome;
  payerReference: string;
  decisionDate: string;
  validFrom: string | null;
  validTo: string | null;
  lines: { id: string; approvedUnits: number }[];
  denialReason: DenialReason | null;
  denialDetail: string;
  determinationDocumentId: string | null;
  reason: string;
}

/**
 * Records a payer determination. This is the only way into APPROVED, PARTIALLY_APPROVED or DENIED.
 * It requires the payer reference, the payer's decision date, per-line approved units, the approved
 * window, and for adverse decisions the determination letter and denial reason.
 */
export function recordDecision(ctx: RequestContext, id: string, input: DecisionInput, now = new Date()): AuthorizationCase {
  assertCan(ctx.role, "authorizations.transition");
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    assertTransition(current.status, input.outcome);
    const payer = requireInOrg(db.payers, ctx.organizationId, current.payerId);
    const today = todayISO(now);
    if (!input.payerReference.trim()) throw validationError("Enter the payer's reference number.");
    if (input.decisionDate > today) throw validationError("The decision date cannot be in the future.");
    if (current.submissionDate && input.decisionDate < current.submissionDate.slice(0, 10)) {
      throw validationError("The decision date cannot be before the request was submitted.");
    }

    let letterId: string | null = null;
    if (input.determinationDocumentId) {
      const document = findInOrg(db.authorizationDocuments, ctx.organizationId, input.determinationDocumentId);
      if (!document || document.authorizationId !== current.id) throw validationError("Choose a document attached to this case.");
      if (document.category !== "PAYER_CORRESPONDENCE") {
        throw validationError("The determination letter must be filed as payer correspondence.");
      }
      letterId = document.id;
    }
    if (input.outcome !== "APPROVED" && !letterId) {
      throw validationError("Attach the payer's determination letter. It is needed to appeal an adverse decision.");
    }

    const approved = new Map(input.lines.map((line) => [line.id, line.approvedUnits]));
    for (const lineId of approved.keys()) {
      if (!current.lines.some((line) => line.id === lineId)) throw validationError("A decision line does not belong to this case.");
    }
    const lines = current.lines.map((line) => {
      let units: number;
      if (input.outcome === "DENIED") units = 0;
      else if (input.outcome === "APPROVED") units = approved.get(line.id) ?? line.requestedUnits;
      else {
        const value = approved.get(line.id);
        if (value === undefined) throw validationError("Enter approved units for every line on a partial approval.");
        units = value;
      }
      if (units > line.requestedUnits) throw validationError(`Approved units for ${line.code} exceed the requested units.`);
      const decision: LineDecision =
        units === 0 ? "DENIED" : units < line.requestedUnits ? "PARTIALLY_APPROVED" : "APPROVED";
      return { ...line, approvedUnits: units, decision };
    });
    if (input.outcome === "APPROVED" && lines.some((line) => line.decision !== "APPROVED")) {
      throw validationError("Some lines were reduced or denied. Record this as a partial approval.");
    }
    if (input.outcome === "PARTIALLY_APPROVED") {
      if (lines.every((line) => line.decision === "APPROVED")) throw validationError("Every line was fully approved. Record this as approved.");
      if (lines.every((line) => line.decision === "DENIED")) throw validationError("No units were approved. Record this as denied.");
    }
    if (input.outcome !== "APPROVED" && !input.denialReason) {
      throw validationError("Choose the reason the payer gave for the adverse decision.");
    }

    const previous = current.status;
    const nowIso = now.toISOString();
    current.lines = lines;
    current.status = input.outcome;
    current.decisionOutcome = input.outcome;
    current.decisionDate = `${input.decisionDate}T12:00:00.000Z`;
    current.payerReference = input.payerReference.trim();
    // payerDueAt is kept so on-time performance can be measured after the decision.
    current.determinationDocumentId = letterId;
    current.validFrom = input.outcome === "DENIED" ? null : input.validFrom;
    current.validTo = input.outcome === "DENIED" ? null : input.validTo;
    current.denialReason = input.outcome === "APPROVED" ? null : input.denialReason;
    current.denialDetail = input.outcome === "APPROVED" ? "" : input.denialDetail.trim();
    current.appealDeadline = input.outcome === "APPROVED" ? null : computeAppealDeadline(input.decisionDate, payer.appealWindowDays);
    current.appealSubmittedAt = null;
    current.updatedAt = nowIso;
    current.updatedBy = ctx.userId;

    pushStatusHistory(db, ctx, current, previous, input.outcome, input.reason, nowIso);
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "decision.recorded",
      summary: `${current.authorizationNumber}: payer decision recorded as ${input.outcome.replaceAll("_", " ").toLowerCase()}`,
      resourceType: "authorization",
      resourceId: current.id,
      authorizationId: current.id,
      patientId: current.patientId,
      metadata: { previous, outcome: input.outcome, payerReference: current.payerReference },
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.decision_recorded",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: {
        authorizationNumber: current.authorizationNumber,
        previous,
        outcome: input.outcome,
        payerReference: current.payerReference,
        determinationDocumentId: letterId,
        denialReason: current.denialReason,
        approvedUnits: lines.map((line) => `${line.code}:${line.approvedUnits}/${line.requestedUnits}`).join(" "),
      },
    });
    notifyStatus(db, ctx, current, input.outcome, input.reason);

    const followUp = (title: string, description: string, priority: Priority) =>
      db.tasks.push({
        id: randomUUID(),
        organizationId: ctx.organizationId,
        authorizationId: current.id,
        patientId: current.patientId,
        title,
        description,
        assignedUserId: current.assignedUserId,
        dueDate: today,
        priority,
        status: "OPEN",
        completedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    if (input.outcome !== "DENIED" && !serviceDateInWindow(current)) {
      followUp(
        `Service date is outside the approved window on ${current.authorizationNumber}`,
        `Approved ${current.validFrom} to ${current.validTo}. Reschedule the service or ask the payer to update the dates.`,
        "URGENT",
      );
    }
    if (!letterId) {
      followUp(`Attach the approval letter for ${current.authorizationNumber}`, "File the payer letter as payer correspondence.", "NORMAL");
    }
    if (current.appealDeadline) {
      followUp(
        `Decide whether to appeal ${current.authorizationNumber}`,
        `Appeal must be filed by ${current.appealDeadline}. Consider requesting a peer-to-peer review first.`,
        "HIGH",
      );
    }
    return current;
  });
}

/** Attach or replace the determination letter after the decision was recorded by phone. */
export function attachDeterminationLetter(ctx: RequestContext, id: string, documentId: string): AuthorizationCase {
  assertCan(ctx.role, "authorizations.write");
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    if (!current.decisionOutcome) throw validationError("Record the payer decision first.");
    const document = findInOrg(db.authorizationDocuments, ctx.organizationId, documentId);
    if (!document || document.authorizationId !== current.id || document.category !== "PAYER_CORRESPONDENCE") {
      throw validationError("Choose a payer correspondence document attached to this case.");
    }
    current.determinationDocumentId = document.id;
    current.updatedAt = new Date().toISOString();
    current.updatedBy = ctx.userId;
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.letter_attached",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: { documentId: document.id, authorizationId: current.id },
    });
    return current;
  });
}

/**
 * Service date changes are allowed after submission because scheduling moves.
 * If the new date leaves the approved window the case raises a critical alert and a task.
 */
export function rescheduleService(ctx: RequestContext, id: string, requestedServiceDate: string, reason: string): AuthorizationCase {
  assertCan(ctx.role, "authorizations.write");
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    if (TERMINAL_STATUSES.has(current.status)) throw validationError("This case is closed.");
    const previousDate = current.requestedServiceDate;
    if (previousDate === requestedServiceDate) return current;
    const nowIso = new Date().toISOString();
    current.requestedServiceDate = requestedServiceDate;
    current.updatedAt = nowIso;
    current.updatedBy = ctx.userId;
    const outside = !serviceDateInWindow(current);
    db.caseNotes.push({
      id: randomUUID(),
      organizationId: ctx.organizationId,
      authorizationId: current.id,
      authorId: ctx.userId,
      content: `Service date changed from ${previousDate} to ${requestedServiceDate}. ${reason}${
        outside ? " The new date is outside the approved window." : ""
      }${AWAITING_PAYER.has(current.status) ? " The payer may need to be told about the new date." : ""}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "authorization.rescheduled",
      summary: `${current.authorizationNumber} service date changed`,
      resourceType: "authorization",
      resourceId: current.id,
      authorizationId: current.id,
      patientId: current.patientId,
      metadata: { outsideWindow: outside },
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.rescheduled",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: { previousDate, requestedServiceDate, outsideWindow: outside },
    });
    if (outside && current.assignedUserId) {
      pushNotification(db, {
        organizationId: ctx.organizationId,
        userId: current.assignedUserId,
        type: "AUTHORIZATION_EXPIRING",
        title: `${current.authorizationNumber}: service date outside approved window`,
        body: `Approved ${current.validFrom} to ${current.validTo}; scheduled ${requestedServiceDate}.`,
        href: `/authorizations/${current.id}`,
      });
    }
    return current;
  });
}

export function recordPeerToPeer(
  ctx: RequestContext,
  id: string,
  input: { status: PeerToPeerStatus; scheduledAt: string | null; notes: string },
): AuthorizationCase {
  assertCan(ctx.role, "authorizations.write");
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    if (!["PENDING", "SUBMITTED", "ADDITIONAL_INFORMATION_REQUESTED", "DENIED", "PARTIALLY_APPROVED", "APPEALED"].includes(current.status)) {
      throw validationError("Peer-to-peer reviews apply to submitted, pending, or adverse decisions.");
    }
    if (input.status === "SCHEDULED" && !input.scheduledAt) throw validationError("Enter when the peer-to-peer is scheduled.");
    current.peerToPeerStatus = input.status;
    current.peerToPeerAt = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : current.peerToPeerAt;
    current.peerToPeerNotes = input.notes.trim();
    current.updatedAt = new Date().toISOString();
    current.updatedBy = ctx.userId;
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "authorization.peer_to_peer",
      summary: `${current.authorizationNumber} peer-to-peer ${input.status.replaceAll("_", " ").toLowerCase()}`,
      resourceType: "authorization",
      resourceId: current.id,
      authorizationId: current.id,
      patientId: current.patientId,
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.peer_to_peer",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: { status: input.status },
    });
    return current;
  });
}

/**
 * Amending a submitted request means filing a new one. This copies the request content into a new
 * draft linked to the original, and withdraws the original if it is still open with the payer.
 */
export function supersedeAuthorization(ctx: RequestContext, id: string, reason: string): AuthorizationCase {
  assertCan(ctx.role, "authorizations.write");
  return mutate((db) => {
    const original = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    if (!isLocked(original.status)) throw validationError("This draft can still be edited directly.");
    if (db.authorizationCases.some((item) => item.organizationId === ctx.organizationId && item.supersedesId === id)) {
      throw validationError("A replacement request already exists for this case.");
    }
    const replacement = createInDb(
      db,
      ctx,
      {
        patientId: original.patientId,
        providerId: original.providerId,
        renderingProviderId: original.renderingProviderId,
        payerId: original.payerId,
        memberId: original.memberId,
        groupNumber: original.groupNumber,
        procedure: original.procedure,
        lines: original.lines.map((line) => ({ ...line, id: undefined })),
        diagnoses: original.diagnoses,
        placeOfService: original.placeOfService,
        siteOfCare: original.siteOfCare,
        facilityName: original.facilityName,
        requestedServiceDate: original.requestedServiceDate,
        priority: original.priority,
        reviewType: original.reviewType,
        clinicalReason: original.clinicalReason,
        assignedUserId: original.assignedUserId,
        internalNotes: `Replaces ${original.authorizationNumber}. ${reason}`,
      },
      { supersedesId: original.id },
    );
    if (!TERMINAL_STATUSES.has(original.status) && !original.decisionOutcome) {
      const previous = original.status;
      const nowIso = new Date().toISOString();
      original.status = "WITHDRAWN";
      original.closedReason = `Replaced by ${replacement.authorizationNumber}. ${reason}`;
      original.payerDueAt = null;
      original.updatedAt = nowIso;
      original.updatedBy = ctx.userId;
      pushStatusHistory(db, ctx, original, previous, "WITHDRAWN", original.closedReason, nowIso);
    }
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.superseded",
      resourceType: "authorization",
      resourceId: original.id,
      metadata: { replacementId: replacement.id, authorizationId: original.id },
    });
    return replacement;
  });
}

export function assignAuthorization(ctx: RequestContext, id: string, assignedUserId: string | null): AuthorizationCase {
  assertCan(ctx.role, "authorizations.assign");
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    if (assignedUserId) assertActiveMember(db, ctx, assignedUserId);
    const previous = current.assignedUserId;
    current.assignedUserId = assignedUserId;
    current.updatedAt = new Date().toISOString();
    current.updatedBy = ctx.userId;
    const name = assignedUserId ? db.profiles.find((profile) => profile.id === assignedUserId)?.fullName ?? "a teammate" : "nobody";
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "authorization.assignment_changed",
      summary: `${current.authorizationNumber} assigned to ${name}`,
      resourceType: "authorization",
      resourceId: current.id,
      authorizationId: current.id,
      patientId: current.patientId,
      metadata: { previous, assignedUserId },
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.assigned",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: { assignedUserId },
    });
    if (assignedUserId && assignedUserId !== ctx.userId) {
      pushNotification(db, {
        organizationId: ctx.organizationId,
        userId: assignedUserId,
        type: "CASE_ASSIGNED",
        title: "Case assigned to you",
        body: `${current.authorizationNumber} was assigned to you.`,
        href: `/authorizations/${current.id}`,
      });
    }
    return current;
  });
}

export function recordPayerResponse(ctx: RequestContext, id: string, payerReference: string, summary: string): AuthorizationCase {
  assertCan(ctx.role, "authorizations.write");
  return mutate((db) => {
    const current = requireInOrg(db.authorizationCases, ctx.organizationId, id);
    if (current.payerReference && current.payerReference !== payerReference && current.decisionOutcome) {
      throw validationError("A decision is already recorded under a different payer reference.");
    }
    current.payerReference = payerReference;
    current.updatedAt = new Date().toISOString();
    current.updatedBy = ctx.userId;
    db.caseNotes.push({
      id: randomUUID(),
      organizationId: ctx.organizationId,
      authorizationId: current.id,
      authorId: ctx.userId,
      content: `Payer response recorded by staff. Reference ${payerReference}. ${summary}`,
      createdAt: current.updatedAt,
      updatedAt: current.updatedAt,
    });
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "payer_response.recorded",
      summary: `Recorded a payer response on ${current.authorizationNumber}`,
      resourceType: "authorization",
      resourceId: current.id,
      authorizationId: current.id,
      patientId: current.patientId,
      metadata: { payerReference },
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "authorization.payer_response",
      resourceType: "authorization",
      resourceId: current.id,
      metadata: { payerReference },
    });
    return current;
  });
}
