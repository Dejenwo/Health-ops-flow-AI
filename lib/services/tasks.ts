import { randomUUID } from "crypto";
import { assertCan } from "@/lib/domain/permissions";
import { validationError } from "@/lib/domain/errors";
import type { RequestContext, Task, TaskStatus } from "@/lib/domain/types";
import { todayISO } from "@/lib/format";
import { bucketTasks } from "@/lib/analytics/metrics";
import { mutate, readDb } from "@/lib/store";
import { pushActivity, pushAudit, pushNotification } from "@/lib/services/events";
import { emptyToNull, findInOrg, inOrg, requireInOrg } from "@/lib/services/query";

export interface TaskInput {
  title: string;
  description: string;
  authorizationId: string | null;
  patientId: string | null;
  assignedUserId: string | null;
  dueDate: string | null;
  priority: Task["priority"];
  status?: TaskStatus;
}

function assertLinks(db: ReturnType<typeof readDb>, ctx: RequestContext, input: TaskInput) {
  if (input.authorizationId && !findInOrg(db.authorizationCases, ctx.organizationId, input.authorizationId)) {
    throw validationError("Choose an authorization in your organization.");
  }
  if (input.patientId && !findInOrg(db.patients, ctx.organizationId, input.patientId)) {
    throw validationError("Choose a patient in your organization.");
  }
  if (input.assignedUserId) {
    const member = db.organizationMembers.find(
      (item) => item.organizationId === ctx.organizationId && item.userId === input.assignedUserId && item.status === "ACTIVE",
    );
    if (!member) throw validationError("Assignee must belong to your organization.");
  }
}

export function listTasks(ctx: RequestContext) {
  assertCan(ctx.role, "tasks.read");
  const db = readDb();
  const tasks = inOrg(db.tasks, ctx.organizationId).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const today = todayISO();
  const buckets = bucketTasks(tasks, today);
  const decorate = (task: Task) => {
    const auth = task.authorizationId ? findInOrg(db.authorizationCases, ctx.organizationId, task.authorizationId) : null;
    const patient = task.patientId ? findInOrg(db.patients, ctx.organizationId, task.patientId) : null;
    return {
      ...task,
      authorizationNumber: auth?.authorizationNumber ?? null,
      patientName: patient ? `${patient.lastName}, ${patient.firstName}` : null,
      assigneeName: task.assignedUserId ? db.profiles.find((profile) => profile.id === task.assignedUserId)?.fullName ?? "User" : "Unassigned",
    };
  };
  return {
    overdue: buckets.overdue.map(decorate),
    dueToday: buckets.dueToday.map(decorate),
    upcoming: buckets.upcoming.map(decorate),
    completed: buckets.completed.map(decorate).slice(0, 20),
    openCount: buckets.overdue.length + buckets.dueToday.length + buckets.upcoming.length,
  };
}

export function createTask(ctx: RequestContext, input: TaskInput): Task {
  assertCan(ctx.role, "tasks.write");
  return mutate((db) => {
    const normalized = {
      ...input,
      authorizationId: emptyToNull(input.authorizationId),
      patientId: emptyToNull(input.patientId),
      assignedUserId: emptyToNull(input.assignedUserId),
      dueDate: emptyToNull(input.dueDate),
      description: input.description || "",
    };
    assertLinks(db, ctx, normalized);
    const now = new Date().toISOString();
    const task: Task = {
      ...normalized,
      status: input.status ?? "OPEN",
      id: randomUUID(),
      organizationId: ctx.organizationId,
      completedAt: input.status === "COMPLETED" ? now : null,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    };
    db.tasks.push(task);
    pushActivity(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      type: "task.created",
      summary: `Created task “${task.title}”`,
      resourceType: "task",
      resourceId: task.id,
      authorizationId: task.authorizationId,
      patientId: task.patientId,
    });
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "task.created",
      resourceType: "task",
      resourceId: task.id,
      metadata: { title: task.title },
    });
    if (task.assignedUserId && task.assignedUserId !== ctx.userId) {
      pushNotification(db, {
        organizationId: ctx.organizationId,
        userId: task.assignedUserId,
        type: "TASK_DUE",
        title: "Task assigned to you",
        body: task.title,
        href: task.authorizationId ? `/authorizations/${task.authorizationId}` : "/tasks",
      });
    }
    return task;
  });
}

export function updateTaskStatus(ctx: RequestContext, id: string, status: TaskStatus): Task {
  assertCan(ctx.role, "tasks.write");
  return mutate((db) => {
    const task = requireInOrg(db.tasks, ctx.organizationId, id);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    task.updatedBy = ctx.userId;
    task.completedAt = status === "COMPLETED" ? task.updatedAt : null;
    if (status === "COMPLETED") {
      pushActivity(db, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        type: "task.completed",
        summary: `Completed task “${task.title}”`,
        resourceType: "task",
        resourceId: task.id,
        authorizationId: task.authorizationId,
        patientId: task.patientId,
      });
    }
    pushAudit(db, {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      event: "task.updated",
      resourceType: "task",
      resourceId: task.id,
      metadata: { status },
    });
    return task;
  });
}
