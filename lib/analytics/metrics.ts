import type { AuthStatus, AuthorizationCase, Priority, Task } from "@/lib/domain/types";
import { AUTH_STATUSES } from "@/lib/domain/types";
import { daysBetween } from "@/lib/format";
import { caseAlerts } from "@/lib/domain/sla";

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export function inRange(iso: string, range: DateRange): boolean {
  const time = new Date(iso).getTime();
  if (range.from && time < range.from.getTime()) return false;
  if (range.to && time > range.to.getTime()) return false;
  return true;
}

export function rangeFromPreset(preset: string, now = new Date()): DateRange {
  const to = now;
  if (preset === "7d") return { from: new Date(now.getTime() - 7 * 86_400_000), to };
  if (preset === "30d") return { from: new Date(now.getTime() - 30 * 86_400_000), to };
  if (preset === "90d") return { from: new Date(now.getTime() - 90 * 86_400_000), to };
  if (preset === "ytd") return { from: new Date(now.getFullYear(), 0, 1), to };
  return { from: null, to: null };
}

const ATTENTION = new Set<AuthStatus>(["NEEDS_INFORMATION", "ADDITIONAL_INFORMATION_REQUESTED"]);

/**
 * Rates are computed from the recorded payer outcome, which survives closing the case.
 * A partial approval counts toward approvals (the patient got care authorized) and is also
 * reported separately so reductions stay visible.
 */
function outcomes(cases: AuthorizationCase[]) {
  const approved = cases.filter((item) => item.decisionOutcome === "APPROVED").length;
  const partial = cases.filter((item) => item.decisionOutcome === "PARTIALLY_APPROVED").length;
  const denied = cases.filter((item) => item.decisionOutcome === "DENIED").length;
  return { approved, partial, denied, total: approved + partial + denied };
}

export function approvalRate(cases: AuthorizationCase[]): number | null {
  const { approved, partial, total } = outcomes(cases);
  return total === 0 ? null : (approved + partial) / total;
}

export function denialRate(cases: AuthorizationCase[]): number | null {
  const { denied, total } = outcomes(cases);
  return total === 0 ? null : denied / total;
}

export function partialApprovalRate(cases: AuthorizationCase[]): number | null {
  const { partial, total } = outcomes(cases);
  return total === 0 ? null : partial / total;
}

/** Share of decided submissions where the payer answered by its due time. */
export function payerOnTimeRate(cases: AuthorizationCase[]): number | null {
  const samples = cases.filter((item) => item.decisionDate && item.submissionDate && item.decisionOutcome);
  if (samples.length === 0) return null;
  const onTime = samples.filter((item) => {
    const due = item.payerDueAt;
    if (!due) return true;
    return new Date(item.decisionDate as string).getTime() <= new Date(due).getTime();
  }).length;
  return onTime / samples.length;
}

export function averageProcessingDays(cases: AuthorizationCase[]): number | null {
  const samples = cases
    .filter((item) => item.decisionDate && (item.submissionDate || item.createdAt))
    .map((item) => {
      const start = new Date(item.submissionDate ?? item.createdAt).getTime();
      const end = new Date(item.decisionDate as string).getTime();
      return Math.max(0, (end - start) / 86_400_000);
    });
  if (samples.length === 0) return null;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

export function statusDistribution(cases: AuthorizationCase[]): { status: AuthStatus; count: number }[] {
  return AUTH_STATUSES.map((status) => ({
    status,
    count: cases.filter((item) => item.status === status).length,
  })).filter((item) => item.count > 0);
}

export function countBy<T extends string>(cases: AuthorizationCase[], key: (item: AuthorizationCase) => T): { key: T; count: number }[] {
  const map = new Map<T, number>();
  for (const item of cases) {
    const value = key(item);
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ key: name, count }))
    .sort((a, b) => b.count - a.count);
}

export function monthlyVolume(cases: AuthorizationCase[], now = new Date()): { month: string; count: number }[] {
  const months: { month: string; count: number }[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const label = date.toLocaleString("en-US", { month: "short" });
    const count = cases.filter((item) => {
      const created = new Date(item.createdAt);
      return created.getFullYear() === date.getFullYear() && created.getMonth() === date.getMonth();
    }).length;
    months.push({ month: label, count });
  }
  return months;
}

export function processingTrend(cases: AuthorizationCase[], now = new Date()): { month: string; days: number }[] {
  const points: { month: string; days: number }[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const label = date.toLocaleString("en-US", { month: "short" });
    const subset = cases.filter((item) => {
      if (!item.decisionDate) return false;
      const decided = new Date(item.decisionDate);
      return decided.getFullYear() === date.getFullYear() && decided.getMonth() === date.getMonth();
    });
    const average = averageProcessingDays(subset);
    points.push({ month: label, days: average === null ? 0 : Number(average.toFixed(1)) });
  }
  return points;
}

export function needsAttention(cases: AuthorizationCase[], now = new Date()): AuthorizationCase[] {
  return cases.filter((item) => {
    if (ATTENTION.has(item.status)) return true;
    return caseAlerts(item, now).some((alert) => alert.severity !== "info");
  });
}

export function alertCounts(cases: AuthorizationCase[], now = new Date()): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of cases) {
    for (const alert of caseAlerts(item, now)) counts[alert.kind] = (counts[alert.kind] ?? 0) + 1;
  }
  return counts;
}

export function pendingLongerThan(cases: AuthorizationCase[], days: number, now = new Date()): AuthorizationCase[] {
  return cases.filter(
    (item) => item.status === "PENDING" && daysBetween(item.submissionDate ?? item.createdAt, now) > days,
  );
}

export interface TaskBuckets {
  overdue: Task[];
  dueToday: Task[];
  upcoming: Task[];
  completed: Task[];
}

export function bucketTasks(tasks: Task[], today: string): TaskBuckets {
  const open = tasks.filter((task) => task.status === "OPEN" || task.status === "IN_PROGRESS");
  return {
    overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today),
    dueToday: open.filter((task) => task.dueDate === today),
    upcoming: open.filter((task) => task.dueDate !== null && task.dueDate > today),
    completed: tasks.filter((task) => task.status === "COMPLETED"),
  };
}

export function priorityWeight(priority: Priority): number {
  if (priority === "URGENT") return 4;
  if (priority === "HIGH") return 3;
  if (priority === "NORMAL") return 2;
  return 1;
}
