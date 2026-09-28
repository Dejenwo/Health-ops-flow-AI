"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionResult } from "@/lib/actions/result";
import {
  authorizationSchema,
  parseInput,
  patientSchema,
  payerSchema,
  providerSchema,
  splitModifiers,
} from "@/lib/domain/schemas";
import { getRequestContext } from "@/lib/services/context";
import { createPatient, updatePatient } from "@/lib/services/patients";
import { createPayer, createProvider, updatePayer, updateProvider } from "@/lib/services/directory";
import { createAuthorization, updateAuthorization } from "@/lib/services/authorizations";

function blank(value: string | undefined): string {
  return value ?? "";
}

export async function savePatientAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(patientSchema, input);
    const payload = {
      mrn: data.mrn,
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      sex: data.sex,
      phone: blank(data.phone),
      email: blank(data.email),
      address: blank(data.address),
      city: blank(data.city),
      state: blank(data.state),
      zip: blank(data.zip),
      primaryPayerId: blank(data.primaryPayerId) || null,
      memberId: blank(data.memberId),
      groupNumber: blank(data.groupNumber),
    };
    const patient = id ? updatePatient(ctx, id, payload) : createPatient(ctx, payload);
    revalidatePath("/patients");
    revalidatePath(`/patients/${patient.id}`);
    redirect(`/patients/${patient.id}`);
  } catch (error) {
    return actionError(error);
  }
}

export async function saveProviderAction(id: string | null, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(providerSchema, input);
    const payload = {
      name: data.name,
      npi: blank(data.npi),
      specialty: data.specialty,
      phone: blank(data.phone),
      email: blank(data.email),
      status: data.status,
      organizationName: data.organizationName,
    };
    if (id) updateProvider(ctx, id, payload);
    else createProvider(ctx, payload);
    revalidatePath("/providers");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function savePayerAction(id: string | null, input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(payerSchema, input);
    const payload = {
      name: data.name,
      type: data.type,
      identifier: data.identifier,
      phone: blank(data.phone),
      fax: blank(data.fax),
      website: blank(data.website),
      notes: blank(data.notes),
      active: data.active !== false,
      standardTurnaroundDays: data.standardTurnaroundDays,
      expeditedTurnaroundHours: data.expeditedTurnaroundHours,
      appealWindowDays: data.appealWindowDays,
      requiredDocuments: [...new Set(data.requiredDocuments)],
    };
    if (id) updatePayer(ctx, id, payload);
    else createPayer(ctx, payload);
    revalidatePath("/payers");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveAuthorizationAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(authorizationSchema, input);
    const payload = {
      patientId: data.patientId,
      providerId: data.providerId,
      renderingProviderId: blank(data.renderingProviderId) || null,
      payerId: data.payerId,
      memberId: blank(data.memberId),
      groupNumber: blank(data.groupNumber),
      procedure: data.procedure,
      lines: data.lines.map((line) => ({
        id: blank(line.id) || undefined,
        codeType: line.codeType,
        code: line.code,
        modifiers: splitModifiers(blank(line.modifiers)),
        description: line.description,
        requestedUnits: line.requestedUnits,
        unitType: line.unitType,
      })),
      diagnoses: data.diagnoses,
      placeOfService: data.placeOfService,
      siteOfCare: data.siteOfCare,
      facilityName: blank(data.facilityName),
      requestedServiceDate: data.requestedServiceDate,
      priority: data.priority,
      reviewType: data.reviewType,
      clinicalReason: blank(data.clinicalReason),
      assignedUserId: blank(data.assignedUserId) || null,
      internalNotes: blank(data.internalNotes),
    };
    const authorization = id ? updateAuthorization(ctx, id, payload) : createAuthorization(ctx, payload);
    revalidatePath("/authorizations");
    revalidatePath(`/authorizations/${authorization.id}`);
    revalidatePath("/dashboard");
    redirect(`/authorizations/${authorization.id}`);
  } catch (error) {
    return actionError(error);
  }
}
