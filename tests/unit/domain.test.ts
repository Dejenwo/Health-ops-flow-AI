import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { can, canAssignRole } from "@/lib/domain/permissions";
import { ALLOWED_TRANSITIONS, assertTransition, canRecordDecision, canTransition, DECISION_STATUSES, isLocked, nextStatuses } from "@/lib/domain/transitions";
import { approvalRate, averageProcessingDays, denialRate, needsAttention, partialApprovalRate, payerOnTimeRate } from "@/lib/analytics/metrics";
import { assertSafeUpload } from "@/lib/security/uploads";
import { toSafeMetadata } from "@/lib/security/redact";
import { redactForModel } from "@/lib/security/phi-redact";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { authorizationSchema, decisionSchema, patientSchema, providerSchema, signUpSchema } from "@/lib/domain/schemas";
import { AppError } from "@/lib/domain/errors";
import { isValidIcd10, isValidNpi, isValidServiceCode, npiWithCheckDigit } from "@/lib/domain/codes";
import { caseAlerts, computeAppealDeadline, computePayerDueAt, PAYER_TIMEFRAME_DEFAULTS } from "@/lib/domain/sla";
import { readinessChecklist, readinessGaps } from "@/lib/domain/readiness";
import { addDaysISO, calendarDaysBetween } from "@/lib/format";
import type { AuthorizationCase, AuthorizationDocument, Payer, Provider } from "@/lib/domain/types";

describe("permissions", () => {
  it("lets viewers read and blocks them from writes", () => {
    expect(can("VIEWER", "patients.read")).toBe(true);
    expect(can("VIEWER", "patients.write")).toBe(false);
    expect(can("VIEWER", "authorizations.transition")).toBe(false);
    expect(can("SPECIALIST", "authorizations.write")).toBe(true);
    expect(can("SPECIALIST", "billing.manage")).toBe(false);
    expect(can("SPECIALIST", "team.role.change")).toBe(false);
    expect(can("ADMIN", "audit.read")).toBe(true);
    expect(can("MANAGER", "authorizations.assign")).toBe(true);
  });

  it("protects owner and admin assignment", () => {
    expect(canAssignRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignRole("MANAGER", "SPECIALIST")).toBe(true);
    expect(canAssignRole("MANAGER", "ADMIN")).toBe(false);
    expect(canAssignRole("SPECIALIST", "VIEWER")).toBe(false);
  });
});

describe("state machine", () => {
  it("allows the documented path and rejects skips", () => {
    expect(canTransition("DRAFT", "READY_FOR_REVIEW")).toBe(true);
    expect(canTransition("READY_FOR_REVIEW", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "PENDING")).toBe(true);
    expect(canTransition("PENDING", "PARTIALLY_APPROVED")).toBe(true);
    expect(canTransition("PARTIALLY_APPROVED", "APPEALED")).toBe(true);
    expect(canTransition("ADDITIONAL_INFORMATION_REQUESTED", "READY_FOR_REVIEW")).toBe(true);
    expect(canTransition("PENDING", "WITHDRAWN")).toBe(true);
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("CLOSED", "PENDING")).toBe(false);
    expect(canTransition("WITHDRAWN", "DRAFT")).toBe(false);
    expect(canTransition("APPROVED", "APPEALED")).toBe(false);
    expect(() => assertTransition("DRAFT", "SUBMITTED")).toThrow(AppError);
  });

  it("keeps decisions out of the plain status menu", () => {
    for (const status of Object.keys(ALLOWED_TRANSITIONS) as (keyof typeof ALLOWED_TRANSITIONS)[]) {
      expect(nextStatuses(status).some((next) => DECISION_STATUSES.has(next))).toBe(false);
    }
    expect(canRecordDecision("PENDING")).toBe(true);
    expect(canRecordDecision("DRAFT")).toBe(false);
  });

  it("locks content once submitted", () => {
    expect(isLocked("DRAFT")).toBe(false);
    expect(isLocked("READY_FOR_REVIEW")).toBe(false);
    expect(isLocked("SUBMITTED")).toBe(true);
    expect(isLocked("APPROVED")).toBe(true);
  });

  it("matches the transition table enforced in Postgres", () => {
    const full = readFileSync("supabase/migrations/20260927120000_workflow_hardening.sql", "utf8");
    const start = full.indexOf("insert into public.authorization_transitions");
    const sql = full.slice(start, full.indexOf(";", start));
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of targets) expect(sql).toContain(`('${from}', '${to}')`);
    }
    const pairs = [...sql.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)].filter(([, from]) => from in ALLOWED_TRANSITIONS);
    const total = Object.values(ALLOWED_TRANSITIONS).reduce((sum, list) => sum + list.length, 0);
    expect(pairs.length).toBe(total);
  });
});

describe("code validation", () => {
  it("checks NPI check digits", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidNpi("DEMO-NPI-1")).toBe(false);
    expect(isValidNpi(npiWithCheckDigit("199900001"))).toBe(true);
  });

  it("checks CPT, HCPCS and ICD-10-CM formats", () => {
    expect(isValidServiceCode("CPT", "72148")).toBe(true);
    expect(isValidServiceCode("CPT", "0042T")).toBe(true);
    expect(isValidServiceCode("CPT", "J1745")).toBe(false);
    expect(isValidServiceCode("HCPCS", "J1745")).toBe(true);
    expect(isValidServiceCode("HCPCS", "72148")).toBe(false);
    expect(isValidIcd10("M17.11")).toBe(true);
    expect(isValidIcd10("R51.9")).toBe(true);
    expect(isValidIcd10("m54.50")).toBe(true);
    expect(isValidIcd10("U07.1")).toBe(false);
    expect(isValidIcd10("12345")).toBe(false);
  });

  it("validates the authorization and decision forms", () => {
    const base = {
      patientId: "00000000-0000-4000-8000-000000000001",
      providerId: "00000000-0000-4000-8000-000000000002",
      payerId: "00000000-0000-4000-8000-000000000003",
      procedure: "Knee",
      lines: [{ codeType: "CPT", code: "27447", description: "TKA", requestedUnits: "1", unitType: "UNITS", modifiers: "RT" }],
      diagnoses: [{ code: "M17.11", description: "OA" }],
      placeOfService: "21",
      siteOfCare: "INPATIENT_HOSPITAL",
      requestedServiceDate: "2026-10-01",
      priority: "NORMAL",
      reviewType: "STANDARD",
    };
    expect(authorizationSchema.safeParse(base).success).toBe(true);
    expect(authorizationSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(authorizationSchema.safeParse({ ...base, lines: [{ ...base.lines[0], code: "ABC" }] }).success).toBe(false);
    expect(authorizationSchema.safeParse({ ...base, lines: [{ ...base.lines[0], modifiers: "RIGHT" }] }).success).toBe(false);
    expect(authorizationSchema.safeParse({ ...base, diagnoses: [{ code: "nope", description: "x" }] }).success).toBe(false);
    const decision = {
      authorizationId: base.patientId,
      outcome: "APPROVED",
      payerReference: "R1",
      decisionDate: "2026-09-20",
      validFrom: "2026-09-20",
      validTo: "2026-09-10",
      reason: "Letter received",
    };
    expect(decisionSchema.safeParse(decision).success).toBe(false);
    expect(decisionSchema.safeParse({ ...decision, validTo: "2026-12-20" }).success).toBe(true);
    expect(decisionSchema.safeParse({ ...decision, outcome: "DENIED", validFrom: "", validTo: "" }).success).toBe(false);
    expect(providerSchema.safeParse({ name: "A", specialty: "B", status: "ACTIVE", organizationName: "C", npi: "1234567890" }).success).toBe(false);
    expect(signUpSchema.safeParse({ fullName: "A", email: "a@b.co", password: "short-pass" }).success).toBe(false);
  });
});

describe("payer timeframes and alerts", () => {
  const now = new Date("2026-09-26T15:00:00.000Z");

  it("computes due times, appeal deadlines and calendar math in UTC", () => {
    const payer = PAYER_TIMEFRAME_DEFAULTS.MEDICARE_ADVANTAGE;
    expect(computePayerDueAt("2026-09-01T10:00:00.000Z", "STANDARD", payer)).toBe("2026-09-08T10:00:00.000Z");
    expect(computePayerDueAt("2026-09-01T10:00:00.000Z", "EXPEDITED", payer)).toBe("2026-09-04T10:00:00.000Z");
    expect(computeAppealDeadline("2026-09-01", 65)).toBe("2026-11-05");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(calendarDaysBetween("2026-09-26", "2026-09-20")).toBe(-6);
  });

  it("raises the right alerts", () => {
    const overdue = caseOf("PENDING", { payerDueAt: "2026-09-24T00:00:00.000Z" });
    expect(caseAlerts(overdue, now).map((alert) => alert.kind)).toContain("PAYER_OVERDUE");
    const dueSoon = caseOf("SUBMITTED", { payerDueAt: "2026-09-27T08:00:00.000Z" });
    expect(caseAlerts(dueSoon, now).map((alert) => alert.kind)).toContain("PAYER_DUE_SOON");
    const expiring = caseOf("APPROVED", { decisionOutcome: "APPROVED", validFrom: "2026-09-01", validTo: "2026-10-01", requestedServiceDate: "2026-09-28", determinationDocumentId: "d" });
    expect(caseAlerts(expiring, now).map((alert) => alert.kind)).toEqual(["AUTH_EXPIRING"]);
    const outside = caseOf("APPROVED", { decisionOutcome: "APPROVED", validFrom: "2026-09-01", validTo: "2026-12-01", requestedServiceDate: "2026-12-15", determinationDocumentId: "d" });
    expect(caseAlerts(outside, now)[0].kind).toBe("SERVICE_OUTSIDE_WINDOW");
    const appeal = caseOf("DENIED", { decisionOutcome: "DENIED", appealDeadline: "2026-10-01", determinationDocumentId: "d" });
    expect(caseAlerts(appeal, now).map((alert) => alert.kind)).toContain("APPEAL_DEADLINE_SOON");
    expect(caseAlerts(caseOf("CLOSED", { payerDueAt: "2020-01-01T00:00:00.000Z" }), now)).toEqual([]);
    const paused = caseOf("ADDITIONAL_INFORMATION_REQUESTED", { payerDueAt: null });
    expect(caseAlerts(paused, now).map((alert) => alert.kind)).toEqual(["INFO_REQUESTED"]);
  });

  it("feeds needs-attention from alerts", () => {
    const cases = [
      caseOf("PENDING", { payerDueAt: "2026-09-20T00:00:00.000Z" }),
      caseOf("PENDING", { payerDueAt: "2026-10-20T00:00:00.000Z" }),
    ];
    expect(needsAttention(cases, now)).toHaveLength(1);
  });
});

describe("analytics", () => {
  const cases = [
    caseOf("APPROVED", { decisionOutcome: "APPROVED", submissionDate: "2026-09-01T00:00:00.000Z", decisionDate: "2026-09-03T00:00:00.000Z", payerDueAt: "2026-09-08T00:00:00.000Z" }),
    caseOf("CLOSED", { decisionOutcome: "DENIED", submissionDate: "2026-09-01T00:00:00.000Z", decisionDate: "2026-09-05T00:00:00.000Z", payerDueAt: "2026-09-04T00:00:00.000Z" }),
    caseOf("PARTIALLY_APPROVED", { decisionOutcome: "PARTIALLY_APPROVED", submissionDate: "2026-09-01T00:00:00.000Z", decisionDate: "2026-09-04T00:00:00.000Z", payerDueAt: "2026-09-08T00:00:00.000Z" }),
    caseOf("PENDING", { submissionDate: "2026-09-01T00:00:00.000Z" }),
  ];

  it("uses recorded outcomes, even after a case is closed", () => {
    expect(approvalRate(cases)).toBeCloseTo(2 / 3);
    expect(denialRate(cases)).toBeCloseTo(1 / 3);
    expect(partialApprovalRate(cases)).toBeCloseTo(1 / 3);
    expect(payerOnTimeRate(cases)).toBeCloseTo(2 / 3);
    expect(averageProcessingDays(cases)).toBeCloseTo(3);
  });
});

describe("packet readiness", () => {
  const provider = { npi: npiWithCheckDigit("199900001") } as Provider;
  const payer = { name: "Summit", requiredDocuments: ["AUTHORIZATION_FORM"] } as unknown as Payer;
  const note = { category: "CLINICAL_NOTE" } as AuthorizationDocument;
  const form = { category: "AUTHORIZATION_FORM" } as AuthorizationDocument;

  it("lists every gap and passes a complete packet", () => {
    const empty = caseOf("DRAFT", { memberId: "", lines: [], diagnoses: [], placeOfService: "" });
    const gaps = readinessGaps(readinessChecklist({ authorization: empty, orderingProvider: { npi: "123" } as Provider, payer, documents: [] }));
    expect(gaps.length).toBe(7);
    const ready = caseOf("DRAFT", {});
    expect(readinessGaps(readinessChecklist({ authorization: ready, orderingProvider: provider, payer, documents: [note, form] }))).toEqual([]);
    expect(readinessGaps(readinessChecklist({ authorization: ready, orderingProvider: provider, payer, documents: [note] }))).toHaveLength(1);
  });
});

describe("security helpers", () => {
  it("rejects unsafe uploads and open redirects", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    expect(assertSafeUpload({ name: "card.png", type: "image/png", size: png.length }, png)).toBe("image/png");
    expect(() => assertSafeUpload({ name: "evil.svg", type: "image/svg+xml", size: 10 }, new Uint8Array(10))).toThrow(AppError);
    expect(() => assertSafeUpload({ name: "note.txt", type: "application/pdf", size: 5 }, new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toThrow(AppError);
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/authorizations")).toBe("/authorizations");
  });

  it("strips secrets from audit metadata but keeps domain ids", () => {
    expect(
      toSafeMetadata({ password: "secret", token: "abc", sessionId: "s", authorization: "Bearer x", status: "DRAFT", authorizationId: "a1" }),
    ).toEqual({ status: "DRAFT", authorizationId: "a1" });
  });

  it("removes direct identifiers before text reaches a model", () => {
    const text = "Elena Adler (DOB: 04/12/1984) called from (555) 010-2000, elena@example.com, 120 Maple Street. SSN 123-45-6789. MRN NS-10021.";
    const out = redactForModel(text, ["Elena", "Adler", "NS-10021"]);
    for (const leaked of ["Elena", "Adler", "555", "elena@", "Maple", "123-45", "NS-10021", "1984"]) expect(out).not.toContain(leaked);
  });

  it("rejects an incomplete patient payload", () => {
    expect(patientSchema.safeParse({ firstName: "A" }).success).toBe(false);
  });
});

describe("database policies", () => {
  it("enables row level security on every tenant table", () => {
    const sql = readFileSync("supabase/migrations/20260926120000_init.sql", "utf8");
    const tables = [
      "profiles",
      "organizations",
      "organization_members",
      "patients",
      "providers",
      "payers",
      "authorization_cases",
      "authorization_status_history",
      "authorization_documents",
      "case_notes",
      "tasks",
      "activity_events",
      "ai_runs",
      "notifications",
      "audit_events",
      "integration_connections",
      "subscriptions",
      "invitations",
    ];
    for (const table of tables) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`create policy ${table}_select`);
    }
    expect(sql).toContain("audit_events are append-only");
    expect(sql).not.toContain("create policy audit_events_update");
    const hardening = readFileSync("supabase/migrations/20260927120000_workflow_hardening.sql", "utf8");
    expect(hardening).toContain("alter table public.authorization_lines enable row level security");
    expect(hardening).toContain("create trigger authorization_cases_rules");
  });
});

function caseOf(status: AuthorizationCase["status"], overrides: Partial<AuthorizationCase>): AuthorizationCase {
  return {
    id: `${status}-${Math.random()}`,
    organizationId: "org",
    authorizationNumber: status,
    patientId: "p",
    providerId: "pr",
    renderingProviderId: null,
    payerId: "pay",
    memberId: "M1",
    groupNumber: "",
    procedure: "Test",
    lines: [{ id: "l1", codeType: "CPT", code: "72148", modifiers: [], description: "MRI", requestedUnits: 1, unitType: "UNITS", approvedUnits: null, decision: "PENDING" }],
    diagnoses: [{ code: "M54.50", description: "Low back pain" }],
    placeOfService: "22",
    siteOfCare: "IMAGING_CENTER",
    facilityName: "",
    requestedServiceDate: "2026-10-20",
    priority: "NORMAL",
    reviewType: "STANDARD",
    clinicalReason: "",
    status,
    assignedUserId: null,
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
    supersedesId: null,
    payerReference: "",
    internalNotes: "",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    createdBy: "u",
    updatedBy: null,
    ...overrides,
  };
}
