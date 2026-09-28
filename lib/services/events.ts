import { randomUUID } from "crypto";
import { toSafeMetadata } from "@/lib/security/redact";
import type {
  ActivityEvent,
  AppNotification,
  AuditEvent,
  Database,
  NotificationType,
  SafeMetadata,
} from "@/lib/domain/types";

export function pushActivity(
  db: Database,
  event: Omit<ActivityEvent, "id" | "createdAt" | "metadata"> & { metadata?: Record<string, unknown>; createdAt?: string },
): void {
  db.activityEvents.push({
    id: randomUUID(),
    createdAt: event.createdAt ?? new Date().toISOString(),
    metadata: toSafeMetadata(event.metadata),
    organizationId: event.organizationId,
    actorId: event.actorId,
    type: event.type,
    summary: event.summary,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    authorizationId: event.authorizationId,
    patientId: event.patientId,
  });
}

export function pushAudit(
  db: Database,
  event: Omit<AuditEvent, "id" | "createdAt" | "metadata"> & { metadata?: Record<string, unknown> },
): void {
  db.auditEvents.push({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    metadata: toSafeMetadata(event.metadata),
    organizationId: event.organizationId,
    actorId: event.actorId,
    event: event.event,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
  });
}

export function pushNotification(
  db: Database,
  notification: Omit<AppNotification, "id" | "createdAt" | "readAt"> & { createdAt?: string },
): void {
  db.notifications.push({
    id: randomUUID(),
    createdAt: notification.createdAt ?? new Date().toISOString(),
    readAt: null,
    organizationId: notification.organizationId,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    href: notification.href,
  });
}

export function notifyRoles(
  db: Database,
  organizationId: string,
  roles: string[],
  exceptUserId: string | null,
  notification: { type: NotificationType; title: string; body: string; href: string | null },
): void {
  const members = db.organizationMembers.filter(
    (member) =>
      member.organizationId === organizationId &&
      member.status === "ACTIVE" &&
      roles.includes(member.role) &&
      member.userId !== exceptUserId,
  );
  for (const member of members) {
    pushNotification(db, { organizationId, userId: member.userId, ...notification });
  }
}

export function blankMeta(): SafeMetadata {
  return {};
}

/**
 * HIPAA §164.312(b) audit controls: record who opened a record containing PHI.
 * Called from page loaders, not from list queries, so the log reflects deliberate access.
 */
export function pushAccess(
  db: Database,
  input: { organizationId: string; actorId: string; resourceType: "authorization" | "patient" | "document"; resourceId: string; metadata?: Record<string, unknown> },
): void {
  pushAudit(db, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    event: `${input.resourceType}.viewed`,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata,
  });
}
