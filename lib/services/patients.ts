import { randomUUID } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import { validationError } from "@/lib/domain/errors";
import type { Patient, RequestContext } from "@/lib/domain/types";
import { mutate, readDb } from "@/lib/store";
import { pushAccess, pushActivity, pushAudit } from "@/lib/services/events";
import { emptyToNull, findInOrg, inOrg, paginate, requireInOrg } from "@/lib/services/query";

export interface PatientQuery {
  q?: string;
  payerId?: string;
  page?: number;
  pageSize?: number;
  sort?: "name" | "mrn" | "updatedAt";
  dir?: "asc" | "desc";
}

export function listPatients(ctx: RequestContext, query: PatientQuery = {}) {
  assertCan(ctx.role, "patients.read");
  const db = readDb();
  const q = query.q?.trim().toLowerCase() ?? "";
  let rows = inOrg(db.patients, ctx.organizationId).filter((patient) => {
    if (query.payerId && patient.primaryPayerId !== query.payerId) return false;
    if (!q) return true;
    const haystack = `${patient.firstName} ${patient.lastName} ${patient.mrn} ${patient.memberId} ${patient.email}`.toLowerCase();
    return haystack.includes(q);
  });
  const dir = query.dir === "desc" ? -1 : 1;
  rows = rows.sort((a, b) => {
    const sort = query.sort ?? "updatedAt";
    const left = sort === "name" ? `${a.lastName} ${a.firstName}` : sort === "mrn" ? a.mrn : a.updatedAt;
    const right = sort === "name" ? `${b.lastName} ${b.firstName}` : sort === "mrn" ? b.mrn : b.updatedAt;
    return left < right ? -1 * dir : left > right ? 1 * dir : 0;
  });
  const page = paginate(rows, query.page, query.pageSize);
  return {
    ...page,
    items: page.items.map((patient) => ({
      ...patient,
      payerName: db.payers.find((payer) => payer.id === patient.primaryPayerId)?.name ?? "—",
    })),
  };
}

export function getPatientDetail(ctx: RequestContext, id: string) {
  assertCan(ctx.role, "patients.read");
  const db = readDb();
  const patient = findInOrg(db.patients, ctx.organizationId, id);
  if (!patient) return null;
  const authorizations = inOrg(db.authorizationCases, ctx.organizationId).filter((item) => item.patientId === id);
  return {
    patient,
    payer: db.payers.find((payer) => payer.id === patient.primaryPayerId && payer.organizationId === ctx.organizationId) ?? null,
    authorizations,
    documents: inOrg(db.authorizationDocuments, ctx.organizationId).filter((item) => item.patientId === id),
    activity: inOrg(db.activityEvents, ctx.organizationId)
      .filter((item) => item.patientId === id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 30),
  };
}

function applyPatient(target: Patient, input: Omit<Patient, "id" | "organizationId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">) {
  Object.assign(target, input);
}

export function createPatient(ctx: RequestContext, input: Omit<Patient, "id" | "organizationId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">): Patient {
  assertCan(ctx.role, "patients.write");
  return mutate((db) => {
    if (inOrg(db.patients, ctx.organizationId).some((patient) => patient.mrn.toLowerCase() === input.mrn.toLowerCase())) {
      throw validationError("A patient with this MRN already exists in your organization.");
    }
    if (input.primaryPayerId && !findInOrg(db.payers, ctx.organizationId, input.primaryPayerId)) {
      throw validationError("Choose a payer from your organization.");
    }
    const now = new Date().toISOString();
    const patient: Patient = {
      ...input,
      primaryPayerId: emptyToNull(input.primaryPayerId),
      id: randomUUID(),
      organizationId: ctx.organizationId,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    };
    db.patients.push(patient);
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "patient.created",
      summary: `Added patient ${patient.lastName}, ${patient.firstName}`,
      resourceType: "patient",
      resourceId: patient.id,
      authorizationId: null,
      patientId: patient.id,
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "patient.created",
      resourceType: "patient",
      resourceId: patient.id,
      metadata: { mrn: patient.mrn },
    });
    return patient;
  });
}

export function updatePatient(
  ctx: RequestContext,
  id: string,
  input: Omit<Patient, "id" | "organizationId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">,
): Patient {
  assertCan(ctx.role, "patients.write");
  return mutate((db) => {
    const patient = requireInOrg(db.patients, ctx.organizationId, id);
    if (inOrg(db.patients, ctx.organizationId).some((item) => item.id !== id && item.mrn.toLowerCase() === input.mrn.toLowerCase())) {
      throw validationError("A patient with this MRN already exists in your organization.");
    }
    if (input.primaryPayerId && !findInOrg(db.payers, ctx.organizationId, input.primaryPayerId)) {
      throw validationError("Choose a payer from your organization.");
    }
    applyPatient(patient, { ...input, primaryPayerId: emptyToNull(input.primaryPayerId) });
    patient.updatedAt = new Date().toISOString();
    patient.updatedBy = ctx.userId;
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "patient.updated",
      summary: `Updated patient ${patient.lastName}, ${patient.firstName}`,
      resourceType: "patient",
      resourceId: patient.id,
      authorizationId: null,
      patientId: patient.id,
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "patient.updated",
      resourceType: "patient",
      resourceId: patient.id,
      metadata: { mrn: patient.mrn },
    });
    return patient;
  });
}

export function recordPatientView(ctx: RequestContext, id: string): void {
  mutate((db) => {
    const patient = db.patients.find((item) => item.id === id && item.organizationId === ctx.organizationId);
    if (!patient) return;
    pushAccess(db, { organizationId: ctx.organizationId, actorId: ctx.userId, resourceType: "patient", resourceId: id });
  });
}
