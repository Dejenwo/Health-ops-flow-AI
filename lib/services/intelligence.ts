import { randomUUID } from "crypto";
import { alertCounts, needsAttention, pendingLongerThan, approvalRate, denialRate, partialApprovalRate, payerOnTimeRate, averageProcessingDays, statusDistribution, countBy, monthlyVolume, processingTrend, rangeFromPreset, inRange } from "@/lib/analytics/metrics";
import { caseAlerts } from "@/lib/domain/sla";
import { readinessChecklist, readinessGaps } from "@/lib/domain/readiness";
import { extractText } from "@/lib/documents/extract";
import { redactForModel } from "@/lib/security/phi-redact";
import { getBlob } from "@/lib/storage/blobs";
import { DENIAL_REASON_LABEL } from "@/lib/domain/labels";
import { getAIProvider } from "@/lib/ai/remote-provider";
import type { AnalysisInput } from "@/lib/ai/types";
import { AI_DISCLAIMER } from "@/lib/domain/types";
import type { AiAnalysis, AiOperation, AiRun, AiTextDraft, RequestContext } from "@/lib/domain/types";
import { assertCan } from "@/lib/domain/permissions";
import { daysBetween } from "@/lib/format";
import { fingerprint } from "@/lib/auth/tokens";
import { mutate, readDb } from "@/lib/store";
import { pushActivity, pushAudit, pushNotification } from "@/lib/services/events";
import { findInOrg, inOrg, requireInOrg } from "@/lib/services/query";

const EXCERPT_CATEGORIES = new Set(["CLINICAL_NOTE", "REFERRAL", "LAB_RESULT", "IMAGING", "PAYER_CORRESPONDENCE"]);
const MAX_EXCERPT_DOCS = 4;

/**
 * Builds the minimum-necessary input for a model. Identifiers (name, DOB, MRN, member ID,
 * address, phone, email) never enter it; free text is filtered for them as a second layer.
 */
async function buildInput(ctx: RequestContext, authorizationId: string, now = new Date()): Promise<AnalysisInput> {
  const db = readDb();
  const authorization = requireInOrg(db.authorizationCases, ctx.organizationId, authorizationId);
  const payer = findInOrg(db.payers, ctx.organizationId, authorization.payerId);
  const provider = findInOrg(db.providers, ctx.organizationId, authorization.providerId);
  const patient = findInOrg(db.patients, ctx.organizationId, authorization.patientId);
  const docs = inOrg(db.authorizationDocuments, ctx.organizationId).filter((item) => item.authorizationId === authorizationId);
  const identifiers = patient
    ? [patient.firstName, patient.lastName, patient.mrn, patient.memberId, patient.email, patient.phone, patient.address, patient.dateOfBirth]
    : [];
  identifiers.push(authorization.memberId, authorization.groupNumber);
  const excerpts: { category: string; text: string }[] = [];
  for (const document of docs.filter((item) => EXCERPT_CATEGORIES.has(item.category)).slice(0, MAX_EXCERPT_DOCS)) {
    const bytes = getBlob(document.storageKey, { filename: document.filename, category: document.category });
    if (!bytes) continue;
    const { text } = await extractText(new Uint8Array(bytes), document.mimeType);
    if (text.trim()) excerpts.push({ category: document.category, text: redactForModel(text, identifiers) });
  }
  const readiness = readinessChecklist({ authorization, orderingProvider: provider, payer, documents: docs });
  return {
    authorizationNumber: authorization.authorizationNumber,
    status: authorization.status,
    priority: authorization.priority,
    reviewType: authorization.reviewType,
    procedure: redactForModel(authorization.procedure, identifiers),
    lines: authorization.lines.map((line) => ({
      codeType: line.codeType,
      code: line.code,
      modifiers: line.modifiers,
      description: line.description,
      requestedUnits: line.requestedUnits,
      unitType: line.unitType,
      approvedUnits: line.approvedUnits,
    })),
    diagnoses: authorization.diagnoses,
    placeOfService: authorization.placeOfService,
    siteOfCare: authorization.siteOfCare,
    payerName: payer?.name ?? "Unknown payer",
    payerType: payer?.type ?? "OTHER",
    memberIdOnFile: authorization.memberId.trim().length > 0,
    requestedServiceDate: authorization.requestedServiceDate,
    clinicalReason: redactForModel(authorization.clinicalReason, identifiers),
    documentCategories: docs.map((item) => item.category),
    documentExcerpts: excerpts,
    readinessGaps: readinessGaps(readiness),
    alerts: caseAlerts(authorization, now).map((alert) => alert.message),
    decisionOutcome: authorization.decisionOutcome,
    denialReason: authorization.denialReason,
    appealDeadline: authorization.appealDeadline,
    ageDays: daysBetween(authorization.submissionDate ?? authorization.createdAt, now),
    assigneeOnFile: Boolean(authorization.assignedUserId),
  };
}

async function storeRun(
  ctx: RequestContext,
  authorizationId: string,
  operation: AiOperation,
  exec: () => Promise<AiAnalysis | AiTextDraft>,
): Promise<AiRun> {
  assertCan(ctx.role, "ai.run");
  const started = Date.now();
  const provider = getAIProvider();
  const inputFingerprint = fingerprint(`${authorizationId}:${operation}`);
  mutate((db) => {
    requireInOrg(db.authorizationCases, ctx.organizationId, authorizationId);
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "ai.requested",
      summary: `Requested ${operation}`,
      resourceType: "ai_run",
      resourceId: authorizationId,
      authorizationId,
      patientId: null,
      metadata: { operation, provider: provider.name },
    });
  });
  try {
    const output = await exec();
    return mutate((db) => {
      const authorization = requireInOrg(db.authorizationCases, ctx.organizationId, authorizationId);
      const run: AiRun = {
        id: randomUUID(),
        organizationId: ctx.organizationId,
        authorizationId,
        requestedBy: ctx.userId,
        provider: provider.name,
        model: provider.model,
        operation,
        status: "COMPLETED",
        inputFingerprint,
        output,
        error: null,
        latencyMs: Date.now() - started,
        createdAt: new Date().toISOString(),
      };
      db.aiRuns.push(run);
      pushActivity(db, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        type: "ai.completed",
        summary: `Completed administrative analysis for ${authorization.authorizationNumber}`,
        resourceType: "ai_run",
        resourceId: run.id,
        authorizationId,
        patientId: authorization.patientId,
        metadata: { operation, provider: provider.name },
      });
      pushAudit(db, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        event: "ai.completed",
        resourceType: "ai_run",
        resourceId: run.id,
        metadata: { operation, provider: provider.name, authorizationId },
      });
      if (authorization.assignedUserId) {
        pushNotification(db, {
          organizationId: ctx.organizationId,
          userId: authorization.assignedUserId,
          type: "AI_ANALYSIS_COMPLETE",
          title: "AI analysis is ready for review",
          body: `${authorization.authorizationNumber}: ${AI_DISCLAIMER}`,
          href: `/authorizations/${authorization.id}`,
        });
      }
      return run;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    mutate((db) => {
      db.aiRuns.push({
        id: randomUUID(),
        organizationId: ctx.organizationId,
        authorizationId,
        requestedBy: ctx.userId,
        provider: provider.name,
        model: provider.model,
        operation,
        status: "FAILED",
        inputFingerprint,
        output: null,
        error: message.slice(0, 300),
        latencyMs: Date.now() - started,
        createdAt: new Date().toISOString(),
      });
    });
    throw error;
  }
}

export async function analyzeAuthorization(ctx: RequestContext, authorizationId: string) {
  assertCan(ctx.role, "ai.run");
  const input = await buildInput(ctx, authorizationId);
  return storeRun(ctx, authorizationId, "analyzeAuthorization", () => getAIProvider().analyzeAuthorization(input));
}

export async function draftPayerFollowup(ctx: RequestContext, authorizationId: string) {
  assertCan(ctx.role, "ai.run");
  const input = await buildInput(ctx, authorizationId);
  return storeRun(ctx, authorizationId, "draftPayerFollowup", () => getAIProvider().draftPayerFollowup(input));
}

export type OperationalKey =
  | "needs_attention"
  | "overdue_authorizations"
  | "missing_documents"
  | "pending_over_five_days"
  | "summarize_urgent"
  | "payer_overdue"
  | "expiring_authorizations"
  | "appeal_deadlines";

export const OPERATIONAL_KEYS: OperationalKey[] = [
  "needs_attention",
  "payer_overdue",
  "expiring_authorizations",
  "appeal_deadlines",
  "overdue_authorizations",
  "missing_documents",
  "pending_over_five_days",
  "summarize_urgent",
];

export function runOperationalQuery(ctx: RequestContext, key: OperationalKey, now = new Date()) {
  assertCan(ctx.role, "authorizations.read");
  const db = readDb();
  const cases = inOrg(db.authorizationCases, ctx.organizationId);
  const documents = inOrg(db.authorizationDocuments, ctx.organizationId);
  const tasks = inOrg(db.tasks, ctx.organizationId);
  const decorate = (item: (typeof cases)[number], detail: string) => {
    const patient = findInOrg(db.patients, ctx.organizationId, item.patientId);
    return {
      href: `/authorizations/${item.id}`,
      title: `${item.authorizationNumber} · ${patient ? `${patient.lastName}, ${patient.firstName}` : "Patient"}`,
      detail,
    };
  };

  if (key === "needs_attention") {
    const matched = needsAttention(cases, now);
    const items = matched.slice(0, 12).map((item) => decorate(item, caseAlerts(item, now)[0]?.message ?? `${item.status} · ${item.priority}`));
    return { title: "What needs attention", disclaimer: AI_DISCLAIMER, items, narrative: `${matched.length} cases have an open alert: payer overdue, expiring approval, appeal deadline, missing information, or urgent work not yet submitted.` };
  }
  const byAlert = (kinds: string[], title: string, narrative: (count: number) => string) => {
    const matched = cases.filter((item) => caseAlerts(item, now).some((alert) => kinds.includes(alert.kind)));
    const items = matched.slice(0, 12).map((item) => decorate(item, caseAlerts(item, now).find((alert) => kinds.includes(alert.kind))?.message ?? ""));
    return { title, disclaimer: AI_DISCLAIMER, items, narrative: narrative(matched.length) };
  };
  if (key === "payer_overdue") {
    return byAlert(["PAYER_OVERDUE", "PAYER_DUE_SOON"], "Payer decisions overdue or due soon", (count) => `${count} submitted cases are past, or within a day of, the payer's decision timeframe.`);
  }
  if (key === "expiring_authorizations") {
    return byAlert(["AUTH_EXPIRING", "AUTH_EXPIRED", "SERVICE_OUTSIDE_WINDOW"], "Approvals expiring or out of window", (count) => `${count} approved cases expire soon or have a service date outside the approved window.`);
  }
  if (key === "appeal_deadlines") {
    return byAlert(["APPEAL_DEADLINE_SOON"], "Appeal deadlines", (count) => `${count} adverse decisions have an appeal deadline within the next ten days.`);
  }
  if (key === "overdue_authorizations") {
    const overdueIds = new Set(tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED" && task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && task.authorizationId).map((task) => task.authorizationId as string));
    const pending = pendingLongerThan(cases, 5);
    const ids = new Set([...overdueIds, ...pending.map((item) => item.id)]);
    const items = cases.filter((item) => ids.has(item.id)).slice(0, 12).map((item) => decorate(item, "Overdue follow-up or pending more than five days"));
    return { title: "Overdue authorizations", disclaimer: AI_DISCLAIMER, items, narrative: `${items.length} cases have overdue tasks or have been pending more than five days.` };
  }
  if (key === "missing_documents") {
    const items = cases
      .filter((item) => !["CLOSED", "WITHDRAWN"].includes(item.status) && !documents.some((doc) => doc.authorizationId === item.id && doc.category === "CLINICAL_NOTE"))
      .slice(0, 12)
      .map((item) => decorate(item, "No clinical note on file"));
    return { title: "Cases missing documents", disclaimer: AI_DISCLAIMER, items, narrative: `${items.length} open cases do not have a clinical note stored.` };
  }
  if (key === "pending_over_five_days") {
    const items = pendingLongerThan(cases, 5).map((item) => decorate(item, `Pending ${daysBetween(item.submissionDate ?? item.createdAt)} days`));
    return { title: "Pending more than five days", disclaimer: AI_DISCLAIMER, items, narrative: `${items.length} cases are still pending more than five days after submission.` };
  }
  const urgent = cases.filter((item) => item.priority === "URGENT" && !["CLOSED", "WITHDRAWN", "APPROVED", "PARTIALLY_APPROVED"].includes(item.status));
  return {
    title: "Urgent work",
    disclaimer: AI_DISCLAIMER,
    items: urgent.slice(0, 12).map((item) => decorate(item, item.status)),
    narrative: `${urgent.length} urgent cases are not approved or closed. This is an administrative queue summary, not a clinical triage.`,
  };
}

export function matchOperationalQuery(text: string): OperationalKey | null {
  const value = text.toLowerCase();
  if (value.includes("appeal")) return "appeal_deadlines";
  if (value.includes("expir") || value.includes("window")) return "expiring_authorizations";
  if (value.includes("payer") && (value.includes("late") || value.includes("overdue") || value.includes("sla"))) return "payer_overdue";
  if (value.includes("missing")) return "missing_documents";
  if (value.includes("five") || value.includes("5 day") || value.includes("pending")) return "pending_over_five_days";
  if (value.includes("overdue")) return "overdue_authorizations";
  if (value.includes("urgent")) return "summarize_urgent";
  if (value.includes("attention") || value.includes("today")) return "needs_attention";
  return null;
}

export function getDashboard(ctx: RequestContext, now = new Date()) {
  assertCan(ctx.role, "analytics.read");
  const db = readDb();
  const cases = inOrg(db.authorizationCases, ctx.organizationId);
  const tasks = inOrg(db.tasks, ctx.organizationId);
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter((task) => task.status === "OPEN" || task.status === "IN_PROGRESS");
  const attention = needsAttention(cases, now);
  const alerts = alertCounts(cases, now);
  const names = new Map(db.profiles.map((profile) => [profile.id, profile.fullName]));
  const recommendations = attention
    .map((item) => {
      const top = caseAlerts(item, now)[0];
      const patient = findInOrg(db.patients, ctx.organizationId, item.patientId);
      return {
        href: `/authorizations/${item.id}`,
        title: item.authorizationNumber,
        patient: patient ? `${patient.lastName}, ${patient.firstName}` : "Patient",
        suggestion: top?.message ?? "Missing information is holding this case.",
        severity: top?.severity ?? "warning",
      };
    })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1))
    .slice(0, 6);

  return {
    kpis: {
      total: cases.length,
      needsAttention: attention.length,
      pending: cases.filter((item) => item.status === "PENDING").length,
      approved: cases.filter((item) => item.decisionOutcome === "APPROVED" || item.decisionOutcome === "PARTIALLY_APPROVED").length,
      denied: cases.filter((item) => item.decisionOutcome === "DENIED").length,
      approvalRate: approvalRate(cases),
      payerOverdue: alerts.PAYER_OVERDUE ?? 0,
      expiring: (alerts.AUTH_EXPIRING ?? 0) + (alerts.AUTH_EXPIRED ?? 0) + (alerts.SERVICE_OUTSIDE_WINDOW ?? 0),
      appealDeadlines: alerts.APPEAL_DEADLINE_SOON ?? 0,
      averageProcessingDays: averageProcessingDays(cases),
      tasksDue: openTasks.filter((task) => task.dueDate !== null && task.dueDate <= today).length,
    },
    statusDistribution: statusDistribution(cases).map((item) => ({ name: item.status, count: item.count })),
    volume: monthlyVolume(cases),
    processing: processingTrend(cases),
    byPayer: countBy(cases, (item) => findInOrg(db.payers, ctx.organizationId, item.payerId)?.name ?? "Unknown").slice(0, 6),
    urgent: cases
      .filter((item) => item.priority === "URGENT" && !["CLOSED", "WITHDRAWN", "APPROVED", "PARTIALLY_APPROVED"].includes(item.status))
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        number: item.authorizationNumber,
        status: item.status,
        procedure: item.procedure,
        patient: (() => {
          const patient = findInOrg(db.patients, ctx.organizationId, item.patientId);
          return patient ? `${patient.lastName}, ${patient.firstName}` : "Patient";
        })(),
      })),
    attention: attention.slice(0, 5).map((item) => ({
      id: item.id,
      number: item.authorizationNumber,
      status: item.status,
      priority: item.priority,
      procedure: item.procedure,
    })),
    tasksDueToday: openTasks
      .filter((task) => task.dueDate === today)
      .slice(0, 5)
      .map((task) => ({ id: task.id, title: task.title, authorizationId: task.authorizationId, priority: task.priority })),
    activity: inOrg(db.activityEvents, ctx.organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 8)
      .map((item) => ({ ...item, actorName: item.actorId ? names.get(item.actorId) ?? "User" : "System" })),
    recommendations,
  };
}

export function getAnalytics(ctx: RequestContext, preset: string) {
  assertCan(ctx.role, "analytics.read");
  const db = readDb();
  const range = rangeFromPreset(preset);
  const cases = inOrg(db.authorizationCases, ctx.organizationId).filter((item) => inRange(item.createdAt, range));
  const members = db.organizationMembers.filter((item) => item.organizationId === ctx.organizationId);
  return {
    volume: cases.length,
    approvalRate: approvalRate(cases),
    denialRate: denialRate(cases),
    partialApprovalRate: partialApprovalRate(cases),
    payerOnTimeRate: payerOnTimeRate(cases),
    byDenialReason: countBy(
      cases.filter((item) => item.denialReason),
      (item) => DENIAL_REASON_LABEL[item.denialReason as keyof typeof DENIAL_REASON_LABEL],
    ),
    pending: cases.filter((item) => item.status === "PENDING").length,
    averageProcessingDays: averageProcessingDays(cases),
    needingInformation: cases.filter((item) => item.status === "NEEDS_INFORMATION" || item.status === "ADDITIONAL_INFORMATION_REQUESTED").length,
    statusDistribution: statusDistribution(cases).map((item) => ({ name: item.status, count: item.count })),
    volumeTrend: monthlyVolume(inOrg(db.authorizationCases, ctx.organizationId)),
    byPayer: countBy(cases, (item) => findInOrg(db.payers, ctx.organizationId, item.payerId)?.name ?? "Unknown"),
    byProcedure: countBy(cases, (item) => item.procedure).slice(0, 8),
    bySpecialist: countBy(cases, (item) => {
      if (!item.assignedUserId) return "Unassigned";
      return db.profiles.find((profile) => profile.id === item.assignedUserId)?.fullName ?? "Unknown";
    }),
    memberCount: members.length,
  };
}
