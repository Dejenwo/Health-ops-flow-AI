import { hashPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/tokens";
import { buildMockAnalysis } from "@/lib/ai/mock-provider";
import { DEMO_ACCOUNTS, DEMO_INVITE_TOKEN, DEMO_PASSWORD } from "@/lib/demo/accounts";
import { npiWithCheckDigit } from "@/lib/domain/codes";
import { computeAppealDeadline, computePayerDueAt, PAYER_TIMEFRAME_DEFAULTS } from "@/lib/domain/sla";
import { CURRENT_SCHEMA_VERSION } from "@/lib/domain/types";
import type {
  AuthStatus,
  AuthorizationCase,
  AuthorizationLine,
  Database,
  DecisionOutcome,
  DocumentCategory,
  Priority,
  SiteOfCare,
  TaskStatus,
  UnitType,
  UserAccount,
} from "@/lib/domain/types";

export { DEMO_ACCOUNTS, DEMO_INVITE_TOKEN, DEMO_PASSWORD };

const FIRST = ["Elena", "Marcus", "Priya", "Jonah", "Alicia", "Owen", "Fatima", "Hugo", "Naomi", "Seth", "Camila", "Andre", "Leila", "Felix", "Ruth", "Ivan", "Sable", "Theo", "Mina", "Oscar", "Greta", "Nolan", "Yara", "Beau", "Ines", "Colin", "Dalia", "Peter", "Hana", "Victor"];
const LAST = ["Adler", "Brooks", "Okoye", "Sato", "Nguyen", "Keller", "Rahman", "Ibarra", "Vogel", "Bennett", "Duarte", "Shah", "Klein", "Moreau", "Park", "Ellison", "Haddad", "Walsh", "Cho", "Petrov", "Lang", "Costa", "Abebe", "Frost", "Marin", "Quincy", "Dalal", "Hart", "Silva", "Novak"];
const STREETS = ["Maple", "Cedar", "Harbor", "Willow", "Summit", "Redwood"];
const CITIES = [
  ["Portland", "OR", "97205"],
  ["Bend", "OR", "97701"],
  ["Boise", "ID", "83702"],
  ["Spokane", "WA", "99201"],
  ["Eugene", "OR", "97401"],
  ["Tacoma", "WA", "98402"],
] as const;

interface SeedLine {
  codeType: "CPT" | "HCPCS";
  code: string;
  description: string;
  units: number;
  unitType: UnitType;
  modifiers?: string[];
}

const PROCEDURES: {
  procedure: string;
  lines: SeedLine[];
  dx: { code: string; description: string }[];
  pos: string;
  site: SiteOfCare;
}[] = [
  { procedure: "MRI lumbar spine without contrast", lines: [{ codeType: "CPT", code: "72148", description: "MRI lumbar spine w/o contrast", units: 1, unitType: "UNITS" }], dx: [{ code: "M54.50", description: "Low back pain, unspecified" }], pos: "22", site: "IMAGING_CENTER" },
  { procedure: "Right total knee arthroplasty", lines: [{ codeType: "CPT", code: "27447", description: "Total knee arthroplasty", units: 1, unitType: "UNITS", modifiers: ["RT"] }], dx: [{ code: "M17.11", description: "Primary osteoarthritis, right knee" }], pos: "21", site: "INPATIENT_HOSPITAL" },
  { procedure: "Diagnostic colonoscopy", lines: [{ codeType: "CPT", code: "45378", description: "Colonoscopy, diagnostic", units: 1, unitType: "UNITS" }], dx: [{ code: "Z86.010", description: "Personal history of colonic polyps" }], pos: "24", site: "AMBULATORY_SURGERY_CENTER" },
  { procedure: "Transthoracic echocardiogram", lines: [{ codeType: "CPT", code: "93306", description: "TTE complete with Doppler", units: 1, unitType: "UNITS" }], dx: [{ code: "R06.00", description: "Dyspnea, unspecified" }], pos: "11", site: "OFFICE" },
  { procedure: "CT abdomen and pelvis with contrast", lines: [{ codeType: "CPT", code: "74177", description: "CT abdomen and pelvis with contrast", units: 1, unitType: "UNITS" }], dx: [{ code: "R10.9", description: "Unspecified abdominal pain" }], pos: "22", site: "OUTPATIENT_HOSPITAL" },
  { procedure: "Physical therapy, right shoulder", lines: [{ codeType: "CPT", code: "97161", description: "PT evaluation, low complexity", units: 1, unitType: "VISITS" }, { codeType: "CPT", code: "97110", description: "Therapeutic exercise, 15 min", units: 12, unitType: "VISITS" }], dx: [{ code: "M25.511", description: "Pain in right shoulder" }], pos: "11", site: "OFFICE" },
  { procedure: "Infliximab infusion series", lines: [{ codeType: "HCPCS", code: "J1745", description: "Infliximab, 10 mg", units: 40, unitType: "UNITS" }, { codeType: "CPT", code: "96413", description: "Chemo/biologic infusion, first hour", units: 4, unitType: "VISITS" }], dx: [{ code: "M06.9", description: "Rheumatoid arthritis, unspecified" }], pos: "22", site: "OUTPATIENT_HOSPITAL" },
  { procedure: "Right shoulder arthroscopic rotator cuff repair", lines: [{ codeType: "CPT", code: "29827", description: "Arthroscopic rotator cuff repair", units: 1, unitType: "UNITS", modifiers: ["RT"] }], dx: [{ code: "M75.121", description: "Complete rotator cuff tear, right, not traumatic" }], pos: "24", site: "AMBULATORY_SURGERY_CENTER" },
  { procedure: "Attended polysomnography", lines: [{ codeType: "CPT", code: "95810", description: "Polysomnography, attended", units: 1, unitType: "UNITS" }], dx: [{ code: "G47.30", description: "Sleep apnea, unspecified" }, { code: "R06.83", description: "Snoring" }], pos: "11", site: "OFFICE" },
  { procedure: "Cardiovascular stress test", lines: [{ codeType: "CPT", code: "93015", description: "Cardiovascular stress test", units: 1, unitType: "UNITS" }], dx: [{ code: "R07.9", description: "Chest pain, unspecified" }], pos: "11", site: "OFFICE" },
];

const STATUS_PLAN: AuthStatus[] = [
  "APPROVED", "APPROVED", "APPROVED", "APPROVED", "APPROVED", "APPROVED", "PARTIALLY_APPROVED", "PARTIALLY_APPROVED",
  "DENIED", "DENIED", "DENIED", "WITHDRAWN",
  "PENDING", "PENDING", "PENDING", "PENDING", "PENDING", "PENDING", "PENDING", "PENDING", "PENDING", "PENDING",
  "NEEDS_INFORMATION", "NEEDS_INFORMATION", "NEEDS_INFORMATION", "NEEDS_INFORMATION", "NEEDS_INFORMATION", "NEEDS_INFORMATION",
  "ADDITIONAL_INFORMATION_REQUESTED", "ADDITIONAL_INFORMATION_REQUESTED", "ADDITIONAL_INFORMATION_REQUESTED", "ADDITIONAL_INFORMATION_REQUESTED", "ADDITIONAL_INFORMATION_REQUESTED",
  "DRAFT", "DRAFT", "DRAFT", "DRAFT", "DRAFT", "DRAFT",
  "READY_FOR_REVIEW", "READY_FOR_REVIEW", "READY_FOR_REVIEW", "READY_FOR_REVIEW",
  "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED",
  "APPEALED", "APPEALED",
  "CLOSED",
];

function isoDaysAgo(now: Date, days: number, hour = 15): string {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  date.setHours(hour, (days * 7) % 60, 0, 0);
  return date.toISOString();
}

function dateDaysFrom(now: Date, days: number): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function priorityFor(index: number, status: AuthStatus): Priority {
  if (status === "PENDING" && index % 4 === 0) return "URGENT";
  if (index % 9 === 0) return "URGENT";
  if (index % 4 === 0) return "HIGH";
  if (index % 5 === 0) return "LOW";
  return "NORMAL";
}

/** Hashing the demo password once per process keeps test resets fast at the production scrypt cost. */
let demoHash: string | null = null;
function demoPasswordHash(): string {
  demoHash ??= hashPassword(DEMO_PASSWORD);
  return demoHash;
}

export function emptyDatabase(): Database {
  return {
    users: [],
    profiles: [],
    organizations: [],
    organizationMembers: [],
    patients: [],
    providers: [],
    payers: [],
    authorizationCases: [],
    authorizationStatusHistory: [],
    authorizationDocuments: [],
    caseNotes: [],
    tasks: [],
    activityEvents: [],
    aiRuns: [],
    notifications: [],
    auditEvents: [],
    integrationConnections: [],
    subscriptions: [],
    invitations: [],
    passwordResetTokens: [],
    contactRequests: [],
    payerAuthRules: [],
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

function seedUser(id: string, email: string, createdAt: string, updatedAt: string): UserAccount {
  return {
    id,
    email,
    passwordHash: demoPasswordHash(),
    sessionVersion: 1,
    identities: [],
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    mfaPendingSecretEncrypted: null,
    mfaRecoveryCodeHashes: [],
    mfaLastStep: -1,
    createdAt,
    updatedAt,
  };
}

export function createSeedDatabase(now = new Date()): Database {
  let sequence = 0;
  const id = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  };
  const stamp = now.toISOString();
  const prefs = {
    caseAssigned: true,
    statusChanged: true,
    taskDue: true,
    aiComplete: true,
    emailEnabled: false,
  };

  const db: Database = emptyDatabase();

  const northstarId = id();
  const lakesideId = id();
  db.organizations.push(
    {
      id: northstarId,
      name: "Northstar Specialty Clinic",
      type: "CLINIC",
      specialty: "Orthopedics, cardiology, and gastroenterology",
      providerCount: 18,
      workflows: {
        priorAuthorization: true,
        eligibility: false,
        referrals: false,
        denials: false,
        documentManagement: true,
      },
      security: { requireMfa: false, idleTimeoutMinutes: 30 },
      caseSequence: 2000,
      sso: null,
      scim: null,
      synthetic: true,
      createdAt: isoDaysAgo(now, 120),
      updatedAt: stamp,
      createdBy: null,
      updatedBy: null,
    },
    {
      id: lakesideId,
      name: "Lakeside Imaging Cooperative",
      type: "CLINIC",
      specialty: "Outpatient imaging",
      providerCount: 6,
      workflows: {
        priorAuthorization: true,
        eligibility: false,
        referrals: false,
        denials: false,
        documentManagement: false,
      },
      security: { requireMfa: false, idleTimeoutMinutes: 30 },
      caseSequence: 9001,
      sso: null,
      scim: null,
      synthetic: true,
      createdAt: isoDaysAgo(now, 80),
      updatedAt: stamp,
      createdBy: null,
      updatedBy: null,
    },
  );

  const userIds = new Map<string, string>();
  for (const account of DEMO_ACCOUNTS) {
    const userId = id();
    userIds.set(account.email, userId);
    const orgId = account.org === "northstar" ? northstarId : lakesideId;
    db.users.push(seedUser(userId, account.email, isoDaysAgo(now, 90), stamp));
    db.profiles.push({
      id: userId,
      fullName: account.name,
      jobTitle: account.title,
      phone: "(555) 010-0199",
      onboardingCompleted: true,
      notificationPreferences: prefs,
      createdAt: isoDaysAgo(now, 90),
      updatedAt: stamp,
    });
    db.organizationMembers.push({
      id: id(),
      organizationId: orgId,
      userId,
      role: account.role,
      status: "ACTIVE",
      lastActiveAt: isoDaysAgo(now, account.role === "OWNER" ? 0 : 1, 9),
      createdAt: isoDaysAgo(now, 90),
      updatedAt: stamp,
      createdBy: null,
      updatedBy: null,
    });
  }

  const ownerId = userIds.get("owner@northstar.demo") as string;
  const managerId = userIds.get("manager@northstar.demo") as string;
  const specialistId = userIds.get("specialist@northstar.demo") as string;
  const adminId = userIds.get("admin@northstar.demo") as string;
  const lakesideOwner = userIds.get("rival@lakeside.demo") as string;
  const assignees = [specialistId, specialistId, managerId, adminId];

  db.organizations[0].createdBy = ownerId;
  db.organizations[1].createdBy = lakesideOwner;

  db.subscriptions.push(
    {
      id: id(),
      organizationId: northstarId,
      plan: "PROFESSIONAL",
      status: "DEMO",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: dateDaysFrom(now, 30),
      createdAt: isoDaysAgo(now, 90),
      updatedAt: stamp,
    },
    {
      id: id(),
      organizationId: lakesideId,
      plan: "STARTER",
      status: "DEMO",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: dateDaysFrom(now, 30),
      createdAt: isoDaysAgo(now, 80),
      updatedAt: stamp,
    },
  );

  const payerDefs = [
    ["Northwind Health Plan", "COMMERCIAL", "PAYER-NW-100"],
    ["Harbor Mutual", "COMMERCIAL", "PAYER-HM-220"],
    ["Cedar Point PPO", "COMMERCIAL", "PAYER-CP-014"],
    ["Summit Advantage", "MEDICARE_ADVANTAGE", "PAYER-SA-441"],
    ["Redwood Community Plan", "MEDICAID_MANAGED", "PAYER-RC-088"],
    ["Pinnacle WorkCover", "WORKERS_COMP", "PAYER-PW-333"],
  ] as const;
  const payerIds: string[] = [];
  payerDefs.forEach((payer, index) => {
    const payerId = id();
    payerIds.push(payerId);
    db.payers.push({
      id: payerId,
      organizationId: northstarId,
      name: payer[0],
      type: payer[1],
      identifier: payer[2],
      phone: `(555) 010-02${index}${index}`,
      fax: `(555) 010-03${index}${index}`,
      website: "https://example.com",
      notes: "Synthetic demo payer. No electronic authorization connection is configured.",
      active: true,
      ...PAYER_TIMEFRAME_DEFAULTS[payer[1]],
      requiredDocuments: (payer[1] === "MEDICARE_ADVANTAGE" ? ["AUTHORIZATION_FORM"] : []) as DocumentCategory[],
      createdAt: isoDaysAgo(now, 100),
      updatedAt: stamp,
      createdBy: ownerId,
      updatedBy: null,
    });
  });

  // Synthetic NPIs with valid check digits so the readiness checks pass. Not real providers.
  const providerDefs = [
    ["Amira Shah, MD", npiWithCheckDigit("199900001"), "Orthopedic surgery"],
    ["Luis Ortega, MD", npiWithCheckDigit("199900002"), "Cardiology"],
    ["Helen Cho, MD", npiWithCheckDigit("199900003"), "Gastroenterology"],
    ["Marcus Reid, PA-C", npiWithCheckDigit("199900004"), "Orthopedics"],
    ["Priya Nandakumar, MD", npiWithCheckDigit("199900005"), "Neurology"],
  ] as const;
  const providerIds: string[] = [];
  providerDefs.forEach((provider, index) => {
    const providerId = id();
    providerIds.push(providerId);
    db.providers.push({
      id: providerId,
      organizationId: northstarId,
      name: provider[0],
      npi: provider[1],
      specialty: provider[2],
      phone: `(555) 010-11${index}${index}`,
      email: `scheduling${index + 1}@northstar.example`,
      status: "ACTIVE",
      organizationName: "Northstar Specialty Clinic",
      createdAt: isoDaysAgo(now, 100),
      updatedAt: stamp,
      createdBy: ownerId,
      updatedBy: null,
    });
  });

  const patientIds: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    const patientId = id();
    patientIds.push(patientId);
    const city = CITIES[index % CITIES.length];
    const year = 1948 + ((index * 3) % 60);
    const month = String((index % 12) + 1).padStart(2, "0");
    const day = String((index % 27) + 1).padStart(2, "0");
    db.patients.push({
      id: patientId,
      organizationId: northstarId,
      mrn: `NS-${10021 + index}`,
      firstName: FIRST[index],
      lastName: LAST[index],
      dateOfBirth: `${year}-${month}-${day}`,
      sex: index % 3 === 0 ? "MALE" : index % 3 === 1 ? "FEMALE" : "UNKNOWN",
      phone: `(555) 010-${String(2000 + index).slice(-4)}`,
      email: `${FIRST[index].toLowerCase()}.${LAST[index].toLowerCase()}@example.com`,
      address: `${120 + index} ${STREETS[index % STREETS.length]} Street`,
      city: city[0],
      state: city[1],
      zip: city[2],
      primaryPayerId: payerIds[index % payerIds.length],
      memberId: `NW${880000 + index}`,
      groupNumber: `GRP-${200 + (index % 6)}`,
      createdAt: isoDaysAgo(now, 60 - index),
      updatedAt: isoDaysAgo(now, index % 5),
      createdBy: specialistId,
      updatedBy: null,
    });
  }

  // A few payer prior-auth rules so the demo shows the "does this need auth?" check.
  const ruleDefs: [string, "CPT" | "HCPCS", string, "REQUIRED" | "NOT_REQUIRED", string][] = [
    ["", "CPT", "72148", "REQUIRED", "Advanced imaging requires auth."],
    ["", "CPT", "74177", "REQUIRED", "Advanced imaging requires auth."],
    ["", "CPT", "27447", "REQUIRED", "Joint replacement."],
    ["", "HCPCS", "J1745", "REQUIRED", "Specialty drug infusion."],
    ["", "CPT", "93306", "NOT_REQUIRED", "Echo exempt per 2026 payer list."],
  ];
  for (const payerId of payerIds.slice(0, 3)) {
    for (const [, codeType, code, requirement, note] of ruleDefs) {
      db.payerAuthRules.push({
        id: id(),
        organizationId: northstarId,
        payerId,
        codeType,
        code,
        requirement,
        note: `Synthetic rule. ${note}`,
        createdAt: stamp,
        updatedAt: stamp,
        createdBy: adminId,
        updatedBy: null,
      });
    }
  }

  const cases: AuthorizationCase[] = [];
  const DECIDED_STATUSES: AuthStatus[] = ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "CLOSED", "APPEALED"];
  STATUS_PLAN.forEach((status, index) => {
    const procedure = PROCEDURES[index % PROCEDURES.length];
    const createdDays =
      status === "PENDING" && index < 16 ? 6 + (index % 8) : status === "DRAFT" ? index % 3 : 2 + ((index * 3) % 36);
    const createdAt = isoDaysAgo(now, createdDays, 8 + (index % 8));
    const submitted = !["DRAFT", "NEEDS_INFORMATION", "READY_FOR_REVIEW"].includes(status);
    const decided = DECIDED_STATUSES.includes(status);
    const caseId = id();
    const patientId = patientIds[index % patientIds.length];
    const patient = db.patients.find((item) => item.id === patientId)!;
    const payerId = payerIds[index % payerIds.length];
    const payer = db.payers.find((item) => item.id === payerId)!;
    const priority = priorityFor(index, status);
    const reviewType = priority === "URGENT" ? "EXPEDITED" : "STANDARD";
    const submissionDate = submitted ? isoDaysAgo(now, Math.max(1, createdDays - 1)) : null;
    const outcome: DecisionOutcome | null =
      status === "APPROVED" || status === "CLOSED"
        ? "APPROVED"
        : status === "PARTIALLY_APPROVED"
          ? "PARTIALLY_APPROVED"
          : status === "DENIED" || status === "APPEALED"
            ? "DENIED"
            : null;
    const decisionDate = decided ? isoDaysAgo(now, Math.max(0, createdDays - 4)) : null;
    const decisionDay = decisionDate?.slice(0, 10) ?? null;
    const lines: AuthorizationLine[] = procedure.lines.map((line, lineIndex) => {
      let approvedUnits: number | null = null;
      if (outcome === "APPROVED") approvedUnits = line.units;
      if (outcome === "DENIED") approvedUnits = 0;
      if (outcome === "PARTIALLY_APPROVED") approvedUnits = lineIndex === procedure.lines.length - 1 ? Math.max(1, Math.floor(line.units / 2)) : line.units;
      if (outcome === "PARTIALLY_APPROVED" && procedure.lines.length === 1 && line.units === 1) approvedUnits = 1;
      const decision = approvedUnits === null ? "PENDING" : approvedUnits === 0 ? "DENIED" : approvedUnits < line.units ? "PARTIALLY_APPROVED" : "APPROVED";
      return {
        id: id(),
        codeType: line.codeType,
        code: line.code,
        modifiers: line.modifiers ?? [],
        description: line.description,
        requestedUnits: line.units,
        unitType: line.unitType,
        approvedUnits,
        decision,
      };
    });
    // Specific cases exercise the alert rules so the demo shows them.
    const expiringSoon = status === "APPROVED" && index === 1;
    const outsideWindow = status === "APPROVED" && index === 2;
    const appealSoon = status === "DENIED" && index === 8;
    const validFrom = outcome && outcome !== "DENIED" ? decisionDay : null;
    const validTo = outcome && outcome !== "DENIED" ? (expiringSoon ? dateDaysFrom(now, 6) : outsideWindow ? dateDaysFrom(now, 3) : dateDaysFrom(now, 90)) : null;
    const requestedServiceDate =
      outsideWindow ? dateDaysFrom(now, 20) : dateDaysFrom(now, status === "APPROVED" ? 5 : 7 + (index % 10));
    const appealDeadline =
      outcome === "DENIED" || outcome === "PARTIALLY_APPROVED"
        ? appealSoon
          ? dateDaysFrom(now, 5)
          : computeAppealDeadline(decisionDay as string, payer.appealWindowDays)
        : null;
    const record: AuthorizationCase = {
      id: caseId,
      organizationId: northstarId,
      authorizationNumber: `PA-2026-${String(1001 + index).padStart(5, "0")}`,
      patientId,
      providerId: providerIds[index % providerIds.length],
      renderingProviderId: index % 4 === 0 ? providerIds[(index + 1) % providerIds.length] : null,
      payerId,
      memberId: patient.memberId,
      groupNumber: patient.groupNumber,
      procedure: procedure.procedure,
      lines,
      diagnoses: procedure.dx,
      placeOfService: procedure.pos,
      siteOfCare: procedure.site,
      facilityName: procedure.site === "OFFICE" ? "Northstar Specialty Clinic" : "Northstar Surgical Partners",
      requestedServiceDate,
      priority,
      reviewType,
      clinicalReason: "Administrative request assembled from synthetic scheduling notes. Not a clinical recommendation.",
      status,
      assignedUserId: status === "DRAFT" && index % 2 === 0 ? null : assignees[index % assignees.length],
      submissionDate,
      payerDueAt: submissionDate ? computePayerDueAt(submissionDate, reviewType, payer) : null,
      decisionDate,
      decisionOutcome: outcome,
      validFrom,
      validTo,
      denialReason: outcome === "DENIED" ? (index % 2 === 0 ? "MEDICAL_NECESSITY" : "MISSING_INFORMATION") : outcome === "PARTIALLY_APPROVED" ? "MEDICAL_NECESSITY" : null,
      denialDetail: outcome && outcome !== "APPROVED" ? "Synthetic payer letter summary." : "",
      determinationDocumentId: null,
      appealDeadline,
      appealSubmittedAt: status === "APPEALED" ? isoDaysAgo(now, 1) : null,
      peerToPeerStatus: status === "DENIED" && index === 9 ? "SCHEDULED" : "NOT_REQUESTED",
      peerToPeerAt: status === "DENIED" && index === 9 ? isoDaysAgo(now, -2, 14) : null,
      peerToPeerNotes: "",
      closedReason: status === "CLOSED" ? "Service completed." : status === "WITHDRAWN" ? "Patient cancelled the procedure." : "",
      supersedesId: null,
      payerReference: submitted ? `REF-${41000 + index}` : "",
      internalNotes: "",
      createdAt,
      updatedAt: isoDaysAgo(now, Math.max(0, createdDays - 2), 16),
      createdBy: specialistId,
      updatedBy: managerId,
    };
    cases.push(record);
    db.authorizationCases.push(record);
    db.authorizationStatusHistory.push({
      id: id(),
      organizationId: northstarId,
      authorizationId: caseId,
      previousStatus: null,
      newStatus: "DRAFT",
      changedBy: specialistId,
      reason: "Case opened from the work queue.",
      createdAt,
    });
    if (status !== "DRAFT") {
      db.authorizationStatusHistory.push({
        id: id(),
        organizationId: northstarId,
        authorizationId: caseId,
        previousStatus: "DRAFT",
        newStatus: status,
        changedBy: managerId,
        reason: "Seeded operational status for the synthetic clinic.",
        createdAt: record.updatedAt,
      });
    }
    db.activityEvents.push({
      id: id(),
      organizationId: northstarId,
      actorId: specialistId,
      type: "authorization.created",
      summary: `Opened ${record.authorizationNumber}`,
      resourceType: "authorization",
      resourceId: caseId,
      authorizationId: caseId,
      patientId,
      metadata: { status },
      createdAt,
    });

    const includeNote = status === "APPROVED" || status === "CLOSED" || index % 2 === 0;
    const includeCard = status !== "NEEDS_INFORMATION" && index % 3 !== 0;
    const includeForm = ["APPROVED", "SUBMITTED", "PENDING", "READY_FOR_REVIEW"].includes(status);
    const includeLetter = Boolean(record.decisionOutcome) && index % 3 !== 1;
    const docs: [string, string][] = [];
    if (includeNote) docs.push(["CLINICAL_NOTE", "clinical-note.txt"]);
    if (includeCard) docs.push(["INSURANCE_CARD", "insurance-card.txt"]);
    if (includeForm) docs.push(["AUTHORIZATION_FORM", "authorization-form.txt"]);
    if (status === "ADDITIONAL_INFORMATION_REQUESTED") docs.push(["PAYER_CORRESPONDENCE", "payer-letter.txt"]);
    if (includeLetter) docs.push(["PAYER_CORRESPONDENCE", "determination-letter.txt"]);
    if (status === "READY_FOR_REVIEW" && !includeNote) docs.push(["CLINICAL_NOTE", "clinical-note.txt"]);
    for (const [category, filename] of docs) {
      const docId = id();
      if (filename === "determination-letter.txt") record.determinationDocumentId = docId;
      db.authorizationDocuments.push({
        id: docId,
        organizationId: northstarId,
        patientId,
        authorizationId: caseId,
        uploadedBy: specialistId,
        filename: `${record.authorizationNumber}-${filename}`,
        storageKey: `seed/${northstarId}/${docId}.txt`,
        size: 420,
        mimeType: "text/plain",
        category: category as "CLINICAL_NOTE",
        processingStatus: "STORED",
        createdAt: record.updatedAt,
        updatedAt: record.updatedAt,
      });
    }

    if (index % 3 === 0) {
      db.caseNotes.push({
        id: id(),
        organizationId: northstarId,
        authorizationId: caseId,
        authorId: specialistId,
        content: "Synthetic note: packet reviewed for missing administrative fields. No payer was contacted by the system.",
        createdAt: record.updatedAt,
        updatedAt: record.updatedAt,
      });
    }
  });

  const taskTargets = db.authorizationCases.filter((item) =>
    ["NEEDS_INFORMATION", "ADDITIONAL_INFORMATION_REQUESTED", "PENDING", "READY_FOR_REVIEW"].includes(item.status),
  );
  taskTargets.forEach((item, index) => {
    const overdue = item.status === "PENDING" && index % 2 === 0;
    const dueToday = item.status === "NEEDS_INFORMATION";
    const status: TaskStatus = index % 7 === 0 ? "COMPLETED" : index % 5 === 0 ? "IN_PROGRESS" : "OPEN";
    const dueDate = status === "COMPLETED" ? dateDaysFrom(now, -2) : overdue ? dateDaysFrom(now, -2) : dueToday ? dateDaysFrom(now, 0) : dateDaysFrom(now, 3);
    db.tasks.push({
      id: id(),
      organizationId: northstarId,
      authorizationId: item.id,
      patientId: item.patientId,
      title:
        item.status === "PENDING"
          ? `Follow up with payer on ${item.authorizationNumber}`
          : `Collect missing documents for ${item.authorizationNumber}`,
      description: "Synthetic work item. Completing it does not contact a payer.",
      assignedUserId: item.assignedUserId ?? specialistId,
      dueDate,
      priority: item.priority,
      status,
      completedAt: status === "COMPLETED" ? isoDaysAgo(now, 1) : null,
      createdAt: item.updatedAt,
      updatedAt: stamp,
      createdBy: managerId,
      updatedBy: null,
    });
  });

  const analyzed = db.authorizationCases.filter((item) => item.priority === "URGENT" || item.status === "NEEDS_INFORMATION").slice(0, 8);
  for (const item of analyzed) {
    const payer = db.payers.find((row) => row.id === item.payerId)!;
    const docs = db.authorizationDocuments.filter((row) => row.authorizationId === item.id).map((row) => row.category);
    const output = buildMockAnalysis({
      authorizationNumber: item.authorizationNumber,
      status: item.status,
      priority: item.priority,
      reviewType: item.reviewType,
      procedure: item.procedure,
      lines: item.lines.map(({ codeType, code, modifiers, description, requestedUnits, unitType, approvedUnits }) => ({
        codeType,
        code,
        modifiers,
        description,
        requestedUnits,
        unitType,
        approvedUnits,
      })),
      diagnoses: item.diagnoses,
      placeOfService: item.placeOfService,
      siteOfCare: item.siteOfCare,
      payerName: payer.name,
      payerType: payer.type,
      memberIdOnFile: Boolean(item.memberId),
      requestedServiceDate: item.requestedServiceDate,
      clinicalReason: item.clinicalReason,
      documentCategories: docs,
      documentExcerpts: [],
      readinessGaps: [],
      alerts: [],
      decisionOutcome: item.decisionOutcome,
      denialReason: item.denialReason,
      appealDeadline: item.appealDeadline,
      ageDays: 6,
      assigneeOnFile: true,
    });
    db.aiRuns.push({
      id: id(),
      organizationId: northstarId,
      authorizationId: item.id,
      requestedBy: specialistId,
      provider: "mock",
      model: "healthflow-mock-admin-v2",
      operation: "analyzeAuthorization",
      status: "COMPLETED",
      inputFingerprint: item.id.slice(0, 12),
      output,
      error: null,
      latencyMs: 12,
      createdAt: item.updatedAt,
    });
  }

  const attention = db.authorizationCases.find((item) => item.priority === "URGENT" && item.status === "PENDING");
  const denied = db.authorizationCases.find((item) => item.status === "DENIED");
  if (attention) {
    db.notifications.push(
      {
        id: id(),
        organizationId: northstarId,
        userId: ownerId,
        type: "TASK_OVERDUE",
        title: "Payer follow-up is overdue",
        body: `${attention.authorizationNumber} has been pending and has an open follow-up task.`,
        href: `/authorizations/${attention.id}`,
        readAt: null,
        createdAt: isoDaysAgo(now, 0, 8),
      },
      {
        id: id(),
        organizationId: northstarId,
        userId: specialistId,
        type: "CASE_ASSIGNED",
        title: "Urgent case assigned",
        body: `${attention.authorizationNumber} is assigned for follow-up.`,
        href: `/authorizations/${attention.id}`,
        readAt: null,
        createdAt: isoDaysAgo(now, 0, 7),
      },
    );
  }
  if (denied) {
    db.notifications.push({
      id: id(),
      organizationId: northstarId,
      userId: managerId,
      type: "AUTHORIZATION_DENIED",
      title: "Denial recorded",
      body: `${denied.authorizationNumber} was marked denied by staff. Review whether an appeal should be prepared.`,
      href: `/authorizations/${denied.id}`,
      readAt: null,
      createdAt: isoDaysAgo(now, 1, 11),
    });
  }
  db.notifications.push({
    id: id(),
    organizationId: northstarId,
    userId: ownerId,
    type: "AI_ANALYSIS_COMPLETE",
    title: "Administrative analysis is ready",
    body: "A mock analysis was stored on an urgent case. Review it before using any draft.",
    href: attention ? `/authorizations/${attention.id}` : "/ai-assistant",
    readAt: null,
    createdAt: isoDaysAgo(now, 0, 9),
  });

  db.auditEvents.push({
    id: id(),
    organizationId: northstarId,
    actorId: ownerId,
    event: "organization.seeded",
    resourceType: "organization",
    resourceId: northstarId,
    metadata: { synthetic: true },
    createdAt: isoDaysAgo(now, 90),
  });

  db.invitations.push({
    id: id(),
    organizationId: northstarId,
    email: "new.specialist@example.com",
    role: "SPECIALIST",
    tokenHash: hashToken(DEMO_INVITE_TOKEN),
    invitedBy: ownerId,
    expiresAt: isoDaysAgo(now, -14),
    acceptedAt: null,
    createdAt: isoDaysAgo(now, 2),
  });

  const lakePayer = id();
  const lakeProvider = id();
  const lakePatient = id();
  db.payers.push({
    id: lakePayer,
    organizationId: lakesideId,
    name: "Lakeside Mutual Demo Plan",
    type: "COMMERCIAL",
    identifier: "PAYER-LK-001",
    phone: "(555) 010-7777",
    fax: "(555) 010-7778",
    website: "https://example.com",
    notes: "Synthetic payer for the second tenant. Not a live integration.",
    active: true,
    ...PAYER_TIMEFRAME_DEFAULTS.COMMERCIAL,
    requiredDocuments: [],
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: lakesideOwner,
    updatedBy: null,
  });
  db.providers.push({
    id: lakeProvider,
    organizationId: lakesideId,
    name: "Nora Blake, MD",
    npi: npiWithCheckDigit("199900101"),
    specialty: "Radiology",
    phone: "(555) 010-8888",
    email: "scheduling@lakeside.example",
    status: "ACTIVE",
    organizationName: "Lakeside Imaging Cooperative",
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: lakesideOwner,
    updatedBy: null,
  });
  db.patients.push({
    id: lakePatient,
    organizationId: lakesideId,
    mrn: "LK-5001",
    firstName: "Rowan",
    lastName: "Isolated",
    dateOfBirth: "1984-04-12",
    sex: "OTHER",
    phone: "(555) 010-9090",
    email: "rowan.isolated@example.com",
    address: "9 Lake View",
    city: "Bend",
    state: "OR",
    zip: "97702",
    primaryPayerId: lakePayer,
    memberId: "LK-SECRET-1",
    groupNumber: "LK-1",
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: lakesideOwner,
    updatedBy: null,
  });
  const lakeCase = id();
  db.authorizationCases.push({
    id: lakeCase,
    organizationId: lakesideId,
    authorizationNumber: "PA-LK-9001",
    patientId: lakePatient,
    providerId: lakeProvider,
    payerId: lakePayer,
    memberId: "LK-SECRET-1",
    groupNumber: "LK-1",
    procedure: "MRI brain without contrast",
    lines: [{ id: id(), codeType: "CPT", code: "70551", modifiers: [], description: "MRI brain w/o contrast", requestedUnits: 1, unitType: "UNITS", approvedUnits: null, decision: "PENDING" }],
    diagnoses: [{ code: "R51.9", description: "Headache, unspecified" }],
    renderingProviderId: null,
    facilityName: "Lakeside Imaging Cooperative",
    placeOfService: "22",
    siteOfCare: "IMAGING_CENTER",
    requestedServiceDate: dateDaysFrom(now, 4),
    priority: "NORMAL",
    reviewType: "STANDARD",
    clinicalReason: "Synthetic second-tenant case used to prove isolation.",
    status: "PENDING",
    assignedUserId: lakesideOwner,
    submissionDate: isoDaysAgo(now, 3),
    payerDueAt: computePayerDueAt(isoDaysAgo(now, 3), "STANDARD", PAYER_TIMEFRAME_DEFAULTS.COMMERCIAL),
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
    payerReference: "LK-REF-1",
    internalNotes: "Must never appear in Northstar search.",
    createdAt: isoDaysAgo(now, 4),
    updatedAt: stamp,
    createdBy: lakesideOwner,
    updatedBy: null,
  });
  db.tasks.push({
    id: id(),
    organizationId: lakesideId,
    authorizationId: lakeCase,
    patientId: lakePatient,
    title: "Lakeside-only task",
    description: "Tenant isolation fixture.",
    assignedUserId: lakesideOwner,
    dueDate: dateDaysFrom(now, 1),
    priority: "LOW",
    status: "OPEN",
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: lakesideOwner,
    updatedBy: null,
  });
  db.caseNotes.push({
    id: id(),
    organizationId: lakesideId,
    authorizationId: lakeCase,
    authorId: lakesideOwner,
    content: "Lakeside private note.",
    createdAt: stamp,
    updatedAt: stamp,
  });

  return db;
}

export function syntheticDocumentText(filename: string, category: string): string {
  const clinical =
    category === "CLINICAL_NOTE"
      ? ["History: symptoms for 10 weeks. Conservative care with physical therapy and NSAIDs failed to improve function."]
      : [];
  return [
    "SYNTHETIC DOCUMENT",
    ...clinical,
    "Organization sample: Northstar Specialty Clinic or Lakeside Imaging Cooperative",
    `File: ${filename}`,
    `Category: ${category}`,
    "This file contains no real patient information.",
    "It exists so the demo can exercise document metadata, access control, and download.",
  ].join("\n");
}
