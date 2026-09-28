import { beforeEach, describe, expect, it } from "vitest";
import { readDb, resetMemoryStore } from "@/lib/store";
import { resetMemoryBlobs } from "@/lib/storage/blobs";
import type { AuthorizationCase, RequestContext } from "@/lib/domain/types";
import {
  createAuthorization,
  getAuthorizationWorkspace,
  recordAuthorizationView,
  recordDecision,
  rescheduleService,
  supersedeAuthorization,
  transitionAuthorization,
  updateAuthorization,
} from "@/lib/services/authorizations";
import { saveDocument } from "@/lib/services/collaboration";
import { analyzeAuthorization } from "@/lib/services/intelligence";
import { AppError } from "@/lib/domain/errors";
import { caseAlerts } from "@/lib/domain/sla";
import { requestFields } from "../fixtures";

const NOW = new Date("2026-09-26T15:00:00.000Z");

function contextFor(email: string): RequestContext {
  const db = readDb();
  const user = db.users.find((item) => item.email === email)!;
  const membership = db.organizationMembers.find((item) => item.userId === user.id && item.status === "ACTIVE")!;
  return {
    userId: user.id,
    email: user.email,
    role: membership.role,
    organizationId: membership.organizationId,
    profile: db.profiles.find((item) => item.id === user.id)!,
    organization: db.organizations.find((item) => item.id === membership.organizationId)!,
  };
}

function attach(ctx: RequestContext, item: AuthorizationCase, category: "CLINICAL_NOTE" | "PAYER_CORRESPONDENCE" | "AUTHORIZATION_FORM", text = "Symptoms 8 weeks. Conservative therapy failed.") {
  const bytes = new TextEncoder().encode(text);
  return saveDocument(ctx, {
    filename: `${category.toLowerCase()}.txt`,
    mimeType: "text/plain",
    size: bytes.length,
    bytes,
    category,
    patientId: item.patientId,
    authorizationId: item.id,
  });
}

function newCase(ctx: RequestContext, payerName = "Northwind Health Plan"): AuthorizationCase {
  const db = readDb();
  const payer = db.payers.find((item) => item.organizationId === ctx.organizationId && item.name === payerName)!;
  const patient = db.patients.find((item) => item.organizationId === ctx.organizationId)!;
  const provider = db.providers.find((item) => item.organizationId === ctx.organizationId)!;
  return createAuthorization(ctx, { ...requestFields(), patientId: patient.id, providerId: provider.id, payerId: payer.id });
}

function submit(ctx: RequestContext, item: AuthorizationCase) {
  attach(ctx, item, "CLINICAL_NOTE");
  transitionAuthorization(ctx, item.id, "READY_FOR_REVIEW", "Packet complete", NOW);
  return transitionAuthorization(ctx, item.id, "SUBMITTED", "Sent via payer portal", NOW);
}

beforeEach(() => {
  resetMemoryBlobs();
  resetMemoryStore(NOW);
});

describe("case numbering", () => {
  it("issues unique sequential numbers that never repeat", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const a = newCase(ctx);
    const b = newCase(ctx);
    expect(a.authorizationNumber).toMatch(/^PA-\d{4}-\d{5}$/);
    expect(a.authorizationNumber).not.toBe(b.authorizationNumber);
    const numbers = readDb().authorizationCases.map((item) => item.authorizationNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("readiness gate and lock", () => {
  it("blocks review until the packet is complete, then locks it after submission", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = newCase(ctx);
    expect(() => transitionAuthorization(ctx, item.id, "READY_FOR_REVIEW", "Try early", NOW)).toThrow(/Clinical support/);
    const submitted = submit(ctx, item);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.payerDueAt).toBe("2026-10-11T15:00:00.000Z");
    expect(() => updateAuthorization(ctx, item.id, { ...requestFields(), patientId: item.patientId, providerId: item.providerId, payerId: item.payerId })).toThrow(/locked/);
    expect(() => transitionAuthorization(ctx, item.id, "APPROVED", "Phone approval", NOW)).toThrow(/Record decision/);
  });

  it("enforces payer-specific required documents", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = newCase(ctx, "Summit Advantage");
    attach(ctx, item, "CLINICAL_NOTE");
    expect(() => transitionAuthorization(ctx, item.id, "READY_FOR_REVIEW", "Ready", NOW)).toThrow(/Authorization form/);
    attach(ctx, item, "AUTHORIZATION_FORM");
    expect(transitionAuthorization(ctx, item.id, "READY_FOR_REVIEW", "Ready", NOW).status).toBe("READY_FOR_REVIEW");
  });

  it("pauses the payer clock while information is requested and restarts it on resubmission", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = submit(ctx, newCase(ctx));
    expect(transitionAuthorization(ctx, item.id, "ADDITIONAL_INFORMATION_REQUESTED", "Payer asked for notes", NOW).payerDueAt).toBeNull();
    transitionAuthorization(ctx, item.id, "READY_FOR_REVIEW", "Added notes", NOW);
    const later = new Date("2026-09-28T15:00:00.000Z");
    expect(transitionAuthorization(ctx, item.id, "SUBMITTED", "Resubmitted", later).payerDueAt).toBe("2026-10-13T15:00:00.000Z");
  });
});

describe("recording payer decisions", () => {
  it("requires evidence and correct units, then sets deadlines and follow-up tasks", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = submit(ctx, newCase(ctx));
    const lines = readDb().authorizationCases.find((row) => row.id === item.id)!.lines;
    const base = {
      payerReference: "NW-778",
      decisionDate: "2026-09-26",
      validFrom: "2026-09-26",
      validTo: "2026-12-26",
      denialReason: "MEDICAL_NECESSITY" as const,
      denialDetail: "Approved 6 of 12 visits",
      determinationDocumentId: null,
      reason: "Letter received",
    };
    const reduced = [
      { id: lines[0].id, approvedUnits: 1 },
      { id: lines[1].id, approvedUnits: 6 },
    ];
    expect(() => recordDecision(ctx, item.id, { ...base, outcome: "PARTIALLY_APPROVED", lines: reduced }, NOW)).toThrow(/determination letter/);
    const letter = attach(ctx, item, "PAYER_CORRESPONDENCE", "Determination: 6 visits approved.");
    expect(() => recordDecision(ctx, item.id, { ...base, outcome: "APPROVED", lines: reduced, determinationDocumentId: letter.id }, NOW)).toThrow(/partial approval/);
    expect(() => recordDecision(ctx, item.id, { ...base, outcome: "PARTIALLY_APPROVED", lines: reduced, decisionDate: "2026-09-30", determinationDocumentId: letter.id }, NOW)).toThrow(/future/);
    expect(() =>
      recordDecision(ctx, item.id, { ...base, outcome: "PARTIALLY_APPROVED", lines: [{ id: lines[1].id, approvedUnits: 20 }, { id: lines[0].id, approvedUnits: 1 }], determinationDocumentId: letter.id }, NOW),
    ).toThrow(/exceed/);

    const decided = recordDecision(ctx, item.id, { ...base, outcome: "PARTIALLY_APPROVED", lines: reduced, determinationDocumentId: letter.id }, NOW);
    expect(decided.status).toBe("PARTIALLY_APPROVED");
    expect(decided.decisionOutcome).toBe("PARTIALLY_APPROVED");
    expect(decided.lines.map((line) => line.decision)).toEqual(["APPROVED", "PARTIALLY_APPROVED"]);
    expect(decided.appealDeadline).toBe("2027-03-25");
    const tasks = readDb().tasks.filter((task) => task.authorizationId === item.id);
    expect(tasks.some((task) => task.title.startsWith("Decide whether to appeal"))).toBe(true);
    const audit = readDb().auditEvents.find((event) => event.event === "authorization.decision_recorded" && event.resourceId === item.id);
    expect(audit?.metadata.approvedUnits).toBe("97161:1/1 97110:6/12");
  });

  it("flags a service date outside the approved window and allows an approval by phone with a letter task", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = submit(ctx, newCase(ctx));
    const approved = recordDecision(
      ctx,
      item.id,
      {
        outcome: "APPROVED",
        payerReference: "NW-900",
        decisionDate: "2026-09-26",
        validFrom: "2026-10-05",
        validTo: "2026-11-05",
        lines: [],
        denialReason: null,
        denialDetail: "",
        determinationDocumentId: null,
        reason: "Approved by phone",
      },
      NOW,
    );
    expect(approved.lines.every((line) => line.approvedUnits === line.requestedUnits)).toBe(true);
    const kinds = caseAlerts(approved, NOW).map((alert) => alert.kind);
    expect(kinds).toContain("SERVICE_OUTSIDE_WINDOW");
    expect(kinds).toContain("DETERMINATION_LETTER_MISSING");
    const fixed = rescheduleService(ctx, item.id, "2026-10-10", "Moved into window");
    expect(caseAlerts(fixed, NOW).map((alert) => alert.kind)).not.toContain("SERVICE_OUTSIDE_WINDOW");
  });

  it("blocks a specialist from filing a late appeal but lets a manager do it", () => {
    const specialist = contextFor("specialist@northstar.demo");
    const manager = contextFor("manager@northstar.demo");
    const item = submit(specialist, newCase(specialist));
    const letter = attach(specialist, item, "PAYER_CORRESPONDENCE", "Denied.");
    recordDecision(
      specialist,
      item.id,
      {
        outcome: "DENIED",
        payerReference: "NW-1",
        decisionDate: "2026-09-26",
        validFrom: null,
        validTo: null,
        lines: [],
        denialReason: "MEDICAL_NECESSITY",
        denialDetail: "",
        determinationDocumentId: letter.id,
        reason: "Denial letter",
      },
      NOW,
    );
    const afterWindow = new Date("2027-06-01T00:00:00.000Z");
    expect(() => transitionAuthorization(specialist, item.id, "APPEALED", "Appeal", afterWindow)).toThrow(/appeal window/);
    const appealed = transitionAuthorization(manager, item.id, "APPEALED", "Late appeal with good cause", afterWindow);
    expect(appealed.appealSubmittedAt).toBeTruthy();
    expect(appealed.payerDueAt).toBeTruthy();
  });
});

describe("replacement requests", () => {
  it("copies a submitted request into a linked draft and withdraws the original", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = submit(ctx, newCase(ctx));
    const replacement = supersedeAuthorization(ctx, item.id, "Wrong CPT on line 2");
    expect(replacement.status).toBe("DRAFT");
    expect(replacement.supersedesId).toBe(item.id);
    expect(replacement.lines.map((line) => line.code)).toEqual(["97161", "97110"]);
    expect(readDb().authorizationCases.find((row) => row.id === item.id)!.status).toBe("WITHDRAWN");
    expect(() => supersedeAuthorization(ctx, item.id, "Again")).toThrow(AppError);
  });
});

describe("PHI access auditing and AI minimization", () => {
  it("records views and shows case audit events that carry the authorization id", () => {
    const owner = contextFor("owner@northstar.demo");
    const item = newCase(owner);
    recordAuthorizationView(owner, item.id);
    const events = readDb().auditEvents.filter((event) => event.resourceId === item.id);
    expect(events.map((event) => event.event)).toContain("authorization.viewed");
    const workspace = getAuthorizationWorkspace(owner, item.id);
    expect(workspace?.audit.length).toBeGreaterThan(0);
  });

  it("reads document text for analysis without sending identifiers", async () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = newCase(ctx);
    const patient = readDb().patients.find((row) => row.id === item.patientId)!;
    attach(ctx, item, "CLINICAL_NOTE", `${patient.firstName} ${patient.lastName}, member ${patient.memberId}. Conservative therapy for 8 weeks failed.`);
    const run = await analyzeAuthorization(ctx, item.id);
    const serialized = JSON.stringify(run.output);
    expect(serialized).toContain("conservative");
    expect(serialized).not.toContain(patient.lastName);
    expect(serialized).not.toContain(patient.memberId);
  });
});
