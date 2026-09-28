import { randomUUID } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import { notFound } from "@/lib/domain/errors";
import type { AuthorizationDocument, CaseNote, DocumentCategory, RequestContext } from "@/lib/domain/types";
import { mutate, readDb } from "@/lib/store";
import { getBlob, putBlob } from "@/lib/storage/blobs";
import { assertSafeUpload, sanitizeFilename } from "@/lib/security/uploads";
import { pushActivity, pushAudit } from "@/lib/services/events";
import { findInOrg, inOrg, requireInOrg } from "@/lib/services/query";

export function addNote(ctx: RequestContext, authorizationId: string, content: string): CaseNote {
  assertCan(ctx.role, "notes.write");
  return mutate((db) => {
    const authorization = requireInOrg(db.authorizationCases, ctx.organizationId, authorizationId);
    const now = new Date().toISOString();
    const note: CaseNote = {
      id: randomUUID(),
      organizationId: ctx.organizationId,
      authorizationId,
      authorId: ctx.userId,
      content,
      createdAt: now,
      updatedAt: now,
    };
    db.caseNotes.push(note);
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "note.added",
      summary: `Added a note on ${authorization.authorizationNumber}`,
      resourceType: "note",
      resourceId: note.id,
      authorizationId,
      patientId: authorization.patientId,
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "note.created",
      resourceType: "note",
      resourceId: note.id,
      metadata: { authorizationId },
    });
    return note;
  });
}

export function listDocuments(ctx: RequestContext, query: { q?: string; category?: string } = {}) {
  assertCan(ctx.role, "documents.read");
  const db = readDb();
  const q = query.q?.trim().toLowerCase() ?? "";
  return inOrg(db.authorizationDocuments, ctx.organizationId)
    .filter((document) => {
      if (query.category && document.category !== query.category) return false;
      if (!q) return true;
      const auth = document.authorizationId ? findInOrg(db.authorizationCases, ctx.organizationId, document.authorizationId) : null;
      const patient = document.patientId ? findInOrg(db.patients, ctx.organizationId, document.patientId) : null;
      const haystack = `${document.filename} ${auth?.authorizationNumber ?? ""} ${patient?.lastName ?? ""} ${patient?.firstName ?? ""}`.toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((document) => ({
      ...document,
      uploaderName: db.profiles.find((profile) => profile.id === document.uploadedBy)?.fullName ?? "User",
      authorizationNumber: document.authorizationId
        ? findInOrg(db.authorizationCases, ctx.organizationId, document.authorizationId)?.authorizationNumber ?? null
        : null,
      patientName: document.patientId
        ? (() => {
            const patient = findInOrg(db.patients, ctx.organizationId, document.patientId as string);
            return patient ? `${patient.lastName}, ${patient.firstName}` : null;
          })()
        : null,
    }));
}

export function saveDocument(
  ctx: RequestContext,
  input: {
    filename: string;
    mimeType: string;
    size: number;
    bytes: Uint8Array;
    category: DocumentCategory;
    patientId: string | null;
    authorizationId: string | null;
  },
): AuthorizationDocument {
  assertCan(ctx.role, "documents.write");
  const mime = assertSafeUpload({ name: input.filename, type: input.mimeType, size: input.size }, input.bytes);
  const existing = readDb();
  if (input.patientId && !findInOrg(existing.patients, ctx.organizationId, input.patientId)) throw notFound();
  if (input.authorizationId && !findInOrg(existing.authorizationCases, ctx.organizationId, input.authorizationId)) throw notFound();
  const id = randomUUID();
  const extension = sanitizeFilename(input.filename).split(".").pop() || "bin";
  const storageKey = `orgs/${ctx.organizationId}/${id}.${extension}`;
  putBlob(storageKey, input.bytes);
  return mutate((db) => {
    const authorization = input.authorizationId ? requireInOrg(db.authorizationCases, ctx.organizationId, input.authorizationId) : null;
    const now = new Date().toISOString();
    const document: AuthorizationDocument = {
      id,
      organizationId: ctx.organizationId,
      patientId: input.patientId,
      authorizationId: input.authorizationId,
      uploadedBy: ctx.userId,
      filename: sanitizeFilename(input.filename),
      storageKey,
      size: input.bytes.byteLength,
      mimeType: mime,
      category: input.category,
      processingStatus: "STORED",
      createdAt: now,
      updatedAt: now,
    };
    db.authorizationDocuments.push(document);
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "document.uploaded",
      summary: `Uploaded ${document.filename}`,
      resourceType: "document",
      resourceId: document.id,
      authorizationId: document.authorizationId,
      patientId: document.patientId ?? authorization?.patientId ?? null,
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "document.uploaded",
      resourceType: "document",
      resourceId: document.id,
      metadata: { filename: document.filename, category: document.category, mimeType: document.mimeType },
    });
    return document;
  });
}

export function readDocument(ctx: RequestContext, id: string): { document: AuthorizationDocument; bytes: Buffer } | null {
  assertCan(ctx.role, "documents.read");
  const db = readDb();
  const document = findInOrg(db.authorizationDocuments, ctx.organizationId, id);
  if (!document) return null;
  const bytes = getBlob(document.storageKey, { filename: document.filename, category: document.category });
  if (!bytes) return null;
  mutate((draft) => {
    pushAudit(draft, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "document.accessed",
      resourceType: "document",
      resourceId: document.id,
      metadata: { filename: document.filename },
    });
  });
  return { document, bytes };
}

export function listNotifications(ctx: RequestContext) {
  const db = readDb();
  return db.notifications
    .filter((item) => item.organizationId === ctx.organizationId && item.userId === ctx.userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 30);
}

export function markNotificationRead(ctx: RequestContext, id: string): void {
  mutate((db) => {
    const notification = db.notifications.find(
      (item) => item.id === id && item.organizationId === ctx.organizationId && item.userId === ctx.userId,
    );
    if (!notification || notification.readAt) return;
    notification.readAt = new Date().toISOString();
  });
}

export function markAllNotificationsRead(ctx: RequestContext): void {
  mutate((db) => {
    const now = new Date().toISOString();
    for (const notification of db.notifications) {
      if (notification.organizationId === ctx.organizationId && notification.userId === ctx.userId && !notification.readAt) {
        notification.readAt = now;
      }
    }
  });
}

export function globalSearch(ctx: RequestContext, q: string) {
  assertCan(ctx.role, "patients.read");
  const query = q.trim().toLowerCase();
  if (query.length < 2) return { patients: [], authorizations: [], tasks: [] };
  const db = readDb();
  const patients = inOrg(db.patients, ctx.organizationId)
    .filter((patient) => `${patient.firstName} ${patient.lastName} ${patient.mrn} ${patient.memberId}`.toLowerCase().includes(query))
    .slice(0, 8)
    .map((patient) => ({
      id: patient.id,
      href: `/patients/${patient.id}`,
      title: `${patient.lastName}, ${patient.firstName}`,
      detail: patient.mrn,
    }));
  const authorizations = inOrg(db.authorizationCases, ctx.organizationId)
    .filter((item) => {
      const patient = findInOrg(db.patients, ctx.organizationId, item.patientId);
      return `${item.authorizationNumber} ${item.procedure} ${item.lines.map((line) => line.code).join(" ")} ${patient?.lastName ?? ""} ${patient?.firstName ?? ""}`.toLowerCase().includes(query);
    })
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      href: `/authorizations/${item.id}`,
      title: item.authorizationNumber,
      detail: item.procedure,
    }));
  const tasks = inOrg(db.tasks, ctx.organizationId)
    .filter((task) => task.title.toLowerCase().includes(query))
    .slice(0, 8)
    .map((task) => ({
      id: task.id,
      href: task.authorizationId ? `/authorizations/${task.authorizationId}` : "/tasks",
      title: task.title,
      detail: task.status,
    }));
  return { patients, authorizations, tasks };
}
