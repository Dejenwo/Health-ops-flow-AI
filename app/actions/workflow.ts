"use server";

import { revalidatePath } from "next/cache";
import { actionError, formString, type ActionResult } from "@/lib/actions/result";
import { DOCUMENT_CATEGORIES, TASK_STATUSES } from "@/lib/domain/types";
import type { DocumentCategory, TaskStatus } from "@/lib/domain/types";
import {
  decisionSchema,
  noteSchema,
  parseInput,
  payerResponseSchema,
  peerToPeerSchema,
  rescheduleSchema,
  supersedeSchema,
  taskSchema,
  transitionSchema,
} from "@/lib/domain/schemas";
import { getRequestContext } from "@/lib/services/context";
import {
  assignAuthorization,
  attachDeterminationLetter,
  recordDecision,
  recordPayerResponse,
  recordPeerToPeer,
  rescheduleService,
  supersedeAuthorization,
  transitionAuthorization,
} from "@/lib/services/authorizations";
import { addNote, markAllNotificationsRead, markNotificationRead, saveDocument } from "@/lib/services/collaboration";
import { analyzeAuthorization, draftPayerFollowup, matchOperationalQuery, OPERATIONAL_KEYS, runOperationalQuery } from "@/lib/services/intelligence";
import type { OperationalKey } from "@/lib/services/intelligence";
import { createTask, updateTaskStatus } from "@/lib/services/tasks";
import { validationError } from "@/lib/domain/errors";

export async function transitionAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(transitionSchema, input);
    transitionAuthorization(ctx, data.authorizationId, data.status, data.reason);
    revalidateCase(data.authorizationId);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

function revalidateCase(authorizationId: string) {
  revalidatePath(`/authorizations/${authorizationId}`);
  revalidatePath("/authorizations");
  revalidatePath("/dashboard");
}

export async function decisionAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(decisionSchema, input);
    recordDecision(ctx, data.authorizationId, {
      outcome: data.outcome,
      payerReference: data.payerReference,
      decisionDate: data.decisionDate,
      validFrom: data.validFrom || null,
      validTo: data.validTo || null,
      lines: data.lines ?? [],
      denialReason: data.denialReason || null,
      denialDetail: data.denialDetail ?? "",
      determinationDocumentId: data.determinationDocumentId || null,
      reason: data.reason,
    });
    revalidateCase(data.authorizationId);
    revalidatePath("/tasks");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function attachLetterAction(authorizationId: string, documentId: string): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    attachDeterminationLetter(ctx, authorizationId, documentId);
    revalidateCase(authorizationId);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function rescheduleAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(rescheduleSchema, input);
    rescheduleService(ctx, data.authorizationId, data.requestedServiceDate, data.reason);
    revalidateCase(data.authorizationId);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function peerToPeerAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(peerToPeerSchema, input);
    recordPeerToPeer(ctx, data.authorizationId, {
      status: data.status,
      scheduledAt: data.scheduledAt || null,
      notes: data.notes ?? "",
    });
    revalidateCase(data.authorizationId);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function supersedeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(supersedeSchema, input);
    const replacement = supersedeAuthorization(ctx, data.authorizationId, data.reason);
    revalidateCase(data.authorizationId);
    return { ok: true, data: { id: replacement.id } };
  } catch (error) {
    return actionError(error);
  }
}

export async function assignAction(authorizationId: string, assignedUserId: string | null): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    assignAuthorization(ctx, authorizationId, assignedUserId || null);
    revalidatePath(`/authorizations/${authorizationId}`);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function payerResponseAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(payerResponseSchema, input);
    recordPayerResponse(ctx, data.authorizationId, data.payerReference, data.summary);
    revalidatePath(`/authorizations/${data.authorizationId}`);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function noteAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(noteSchema, input);
    addNote(ctx, data.authorizationId, data.content);
    revalidatePath(`/authorizations/${data.authorizationId}`);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function taskAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const data = parseInput(taskSchema, input);
    createTask(ctx, {
      title: data.title,
      description: data.description || "",
      authorizationId: data.authorizationId || null,
      patientId: data.patientId || null,
      assignedUserId: data.assignedUserId || null,
      dueDate: data.dueDate || null,
      priority: data.priority,
      status: data.status,
    });
    revalidatePath("/tasks");
    if (data.authorizationId) revalidatePath(`/authorizations/${data.authorizationId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function taskStatusAction(id: string, status: string): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    if (!TASK_STATUSES.includes(status as TaskStatus)) throw validationError("Unknown task status.");
    updateTaskStatus(ctx, id, status as TaskStatus);
    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function uploadDocumentAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    const file = formData.get("file");
    if (!(file instanceof File)) throw validationError("Choose a file.");
    const category = formString(formData, "category");
    if (!DOCUMENT_CATEGORIES.includes(category as DocumentCategory)) throw validationError("Choose a document category.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const authorizationId = formString(formData, "authorizationId") || null;
    const patientId = formString(formData, "patientId") || null;
    saveDocument(ctx, {
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      bytes,
      category: category as DocumentCategory,
      authorizationId,
      patientId,
    });
    revalidatePath("/documents");
    if (authorizationId) revalidatePath(`/authorizations/${authorizationId}`);
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function uploadDocumentFormAction(formData: FormData): Promise<void> {
  const result = await uploadDocumentAction(formData);
  if (!result.ok) throw new Error(result.error);
}

export async function analyzeAction(authorizationId: string): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    await analyzeAuthorization(ctx, authorizationId);
    revalidatePath(`/authorizations/${authorizationId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function followupDraftAction(authorizationId: string): Promise<ActionResult<{ text: string }>> {
  try {
    const ctx = await getRequestContext();
    const run = await draftPayerFollowup(ctx, authorizationId);
    const text = run.output && "text" in run.output ? run.output.text : "";
    revalidatePath(`/authorizations/${authorizationId}`);
    return { ok: true, data: { text } };
  } catch (error) {
    return actionError(error);
  }
}

export async function operationalQueryAction(key: string): Promise<ActionResult<ReturnType<typeof runOperationalQuery>>> {
  try {
    const ctx = await getRequestContext();
    const allowed = OPERATIONAL_KEYS;
    const resolved = (allowed.includes(key as OperationalKey) ? key : matchOperationalQuery(key)) as OperationalKey | null;
    if (!resolved) {
      return {
        ok: false,
        error: "Choose one of the operational questions. HealthFlow does not run open-ended database queries.",
      };
    }
    return { ok: true, data: runOperationalQuery(ctx, resolved) };
  } catch (error) {
    return actionError(error);
  }
}

export async function markReadAction(id: string): Promise<void> {
  const ctx = await getRequestContext();
  markNotificationRead(ctx, id);
  revalidatePath("/dashboard");
}

export async function markAllReadAction(): Promise<void> {
  const ctx = await getRequestContext();
  markAllNotificationsRead(ctx);
  revalidatePath("/dashboard");
}
