"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { taskAction, taskStatusAction } from "@/app/actions/workflow";
import { PriorityBadge, TaskStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fieldClass } from "@/components/page-header";
import { PRIORITIES, TASK_STATUSES, type TaskStatus } from "@/lib/domain/types";
import { PRIORITY_LABEL } from "@/lib/domain/labels";

export interface TaskCard {
  id: string;
  title: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: TaskStatus;
  dueDate: string | null;
  authorizationNumber: string | null;
  authorizationId: string | null;
  patientName: string | null;
  assigneeName: string;
}

export function TaskBoard({
  columns,
  canWrite,
  members,
}: {
  columns: { key: string; title: string; tasks: TaskCard[] }[];
  canWrite: boolean;
  members: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {canWrite ? (
        <form
          className="grid gap-2 rounded-xl border bg-card p-4 md:grid-cols-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const result = await taskAction({
              title: String(form.get("title") ?? ""),
              description: String(form.get("description") ?? ""),
              dueDate: String(form.get("dueDate") ?? ""),
              priority: String(form.get("priority") ?? "NORMAL"),
              assignedUserId: String(form.get("assignedUserId") ?? ""),
            });
            if (!result.ok) setError(result.error);
            else {
              setError(null);
              event.currentTarget.reset();
              router.refresh();
            }
          }}
        >
          <Input name="title" required placeholder="Task title" className="md:col-span-2" />
          <Input name="dueDate" type="date" aria-label="Due date" />
          <select name="priority" className={fieldClass} defaultValue="NORMAL" aria-label="Priority">
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
          </select>
          <Textarea name="description" placeholder="Description" className="md:col-span-2" />
          <select name="assignedUserId" className={fieldClass} aria-label="Assignee">
            <option value="">Unassigned</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
          </select>
          <Button type="submit">Create task</Button>
        </form>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-4">
        {columns.map((column) => (
          <section key={column.key} className="space-y-2">
            <h2 className="text-sm font-medium">{column.title} <span className="text-muted-foreground">{column.tasks.length}</span></h2>
            {column.tasks.map((task) => (
              <article key={task.id} className="rounded-xl border bg-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{task.title}</p>
                  <PriorityBadge priority={task.priority} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{task.authorizationNumber ?? "No case"} · {task.assigneeName}</p>
                <p className="text-xs text-muted-foreground">Due {task.dueDate ?? "—"}</p>
                <div className="mt-2"><TaskStatusBadge status={task.status} /></div>
                {canWrite && task.status !== "COMPLETED" ? (
                  <select
                    className={`${fieldClass} mt-2`}
                    defaultValue={task.status}
                    aria-label={`Status for ${task.title}`}
                    onChange={(event) => {
                      const status = event.target.value;
                      if (TASK_STATUSES.includes(status as TaskStatus)) {
                        void taskStatusAction(task.id, status).then(() => router.refresh());
                      }
                    }}
                  >
                    {TASK_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
