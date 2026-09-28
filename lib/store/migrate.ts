import { randomUUID } from "crypto";
import { idleTimeoutDefaultMinutes } from "@/lib/config";
import { PAYER_TIMEFRAME_DEFAULTS } from "@/lib/domain/sla";
import { CURRENT_SCHEMA_VERSION, type Database, type PayerType } from "@/lib/domain/types";

type Loose = Record<string, unknown>;

/**
 * Upgrades a stored database document to the current schema. Each step is idempotent so a
 * partially migrated file is safe to run again. v1 is the original MVP shape.
 */
export function migrateDatabase(raw: unknown): { db: Database; migrated: boolean } {
  const db = raw as Database & Loose;
  const from = typeof db.schemaVersion === "number" ? db.schemaVersion : 1;
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Data file schema v${from} is newer than this build (v${CURRENT_SCHEMA_VERSION}). Upgrade the app.`);
  }
  if (from === CURRENT_SCHEMA_VERSION) return { db, migrated: false };
  if (from < 2) toV2(db);
  if (from < 3) toV3(db);
  if (from < 4) for (const org of db.organizations as unknown as Loose[]) org.scim ??= null;
  if (from < 5) (db as Loose).payerAuthRules ??= [];
  db.schemaVersion = CURRENT_SCHEMA_VERSION;
  return { db, migrated: true };
}

function toV2(db: Database & Loose) {
  for (const user of db.users as unknown as Loose[]) {
    user.sessionVersion ??= 1;
    user.mfaEnabled ??= false;
    user.mfaSecretEncrypted ??= null;
    user.mfaPendingSecretEncrypted ??= null;
    user.mfaRecoveryCodeHashes ??= [];
    user.mfaLastStep ??= -1;
  }
  for (const org of db.organizations as unknown as Loose[]) {
    org.security ??= { requireMfa: false, idleTimeoutMinutes: idleTimeoutDefaultMinutes() };
    if (typeof org.caseSequence !== "number") {
      const count = (db.authorizationCases as unknown as Loose[]).filter((item) => item.organizationId === org.id).length;
      org.caseSequence = 5000 + count;
    }
  }
  for (const payer of db.payers as unknown as Loose[]) {
    const defaults = PAYER_TIMEFRAME_DEFAULTS[(payer.type as PayerType) ?? "OTHER"] ?? PAYER_TIMEFRAME_DEFAULTS.OTHER;
    payer.standardTurnaroundDays ??= defaults.standardTurnaroundDays;
    payer.expeditedTurnaroundHours ??= defaults.expeditedTurnaroundHours;
    payer.appealWindowDays ??= defaults.appealWindowDays;
    payer.requiredDocuments ??= [];
  }
  for (const item of db.authorizationCases as unknown as Loose[]) {
    if (!Array.isArray(item.lines)) {
      const code = String(item.procedureCode ?? "");
      item.lines = code
        ? [
            {
              id: randomUUID(),
              codeType: /^[A-V]\d{4}$/.test(code) ? "HCPCS" : "CPT",
              code,
              modifiers: [],
              description: String(item.procedure ?? ""),
              requestedUnits: 1,
              unitType: "UNITS",
              approvedUnits: item.status === "APPROVED" || item.status === "CLOSED" ? 1 : item.status === "DENIED" ? 0 : null,
              decision: item.status === "APPROVED" || item.status === "CLOSED" ? "APPROVED" : item.status === "DENIED" ? "DENIED" : "PENDING",
            },
          ]
        : [];
    }
    if (!Array.isArray(item.diagnoses)) {
      item.diagnoses = item.diagnosisCode ? [{ code: item.diagnosisCode, description: item.diagnosisDescription ?? "" }] : [];
    }
    item.renderingProviderId ??= null;
    item.facilityName ??= "";
    item.placeOfService ??= "";
    item.siteOfCare ??= "OTHER";
    item.reviewType ??= item.priority === "URGENT" ? "EXPEDITED" : "STANDARD";
    item.payerDueAt ??= null;
    item.decisionOutcome ??=
      item.status === "APPROVED" || item.status === "CLOSED" ? "APPROVED" : item.status === "DENIED" || item.status === "APPEALED" ? "DENIED" : null;
    item.validFrom ??= item.decisionOutcome === "APPROVED" && item.decisionDate ? String(item.decisionDate).slice(0, 10) : null;
    item.validTo ??= item.expirationDate ?? null;
    item.denialReason ??= item.decisionOutcome === "DENIED" ? "OTHER" : null;
    item.denialDetail ??= "";
    item.determinationDocumentId ??= null;
    item.appealDeadline ??= null;
    item.appealSubmittedAt ??= null;
    item.peerToPeerStatus ??= "NOT_REQUESTED";
    item.peerToPeerAt ??= null;
    item.peerToPeerNotes ??= "";
    item.closedReason ??= "";
    item.supersedesId ??= null;
    delete item.procedureCode;
    delete item.diagnosisCode;
    delete item.diagnosisDescription;
    delete item.expirationDate;
  }
}

function toV3(db: Database & Loose) {
  for (const user of db.users as unknown as Loose[]) user.identities ??= [];
  for (const org of db.organizations as unknown as Loose[]) org.sso ??= null;
}
