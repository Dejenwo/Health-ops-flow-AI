import type React from "react";
import {
  Archive,
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardCheck,
  Hourglass,
  Info,
  MessageSquareWarning,
  OctagonAlert,
  PencilLine,
  Scale,
  Send,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/domain/labels";
import type { AuthStatus, Priority, TaskStatus } from "@/lib/domain/types";
import type { AlertKind, AlertSeverity } from "@/lib/domain/sla";
import { cn } from "cn";

const statusClass: Record<AuthStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  NEEDS_INFORMATION: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  READY_FOR_REVIEW: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200",
  SUBMITTED: "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-200",
  PENDING: "bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-200",
  ADDITIONAL_INFORMATION_REQUESTED: "bg-orange-100 text-orange-950 dark:bg-orange-500/15 dark:text-orange-100",
  APPROVED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
  PARTIALLY_APPROVED: "bg-teal-100 text-teal-900 dark:bg-teal-500/15 dark:text-teal-200",
  DENIED: "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200",
  APPEALED: "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200",
  WITHDRAWN: "bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-200",
  CLOSED: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
};

/** An icon per status so status never depends on color alone. */
const statusIcon: Record<AuthStatus, LucideIcon> = {
  DRAFT: PencilLine,
  NEEDS_INFORMATION: MessageSquareWarning,
  READY_FOR_REVIEW: ClipboardCheck,
  SUBMITTED: Send,
  PENDING: Hourglass,
  ADDITIONAL_INFORMATION_REQUESTED: MessageSquareWarning,
  APPROVED: CircleCheck,
  PARTIALLY_APPROVED: CircleDashed,
  DENIED: CircleX,
  APPEALED: Scale,
  WITHDRAWN: Ban,
  CLOSED: Archive,
};

const priorityClass: Record<Priority, string> = {
  LOW: "bg-muted text-muted-foreground",
  NORMAL: "bg-secondary text-secondary-foreground",
  HIGH: "bg-amber-100 text-amber-950 dark:bg-amber-500/15 dark:text-amber-100",
  URGENT: "bg-rose-100 text-rose-950 dark:bg-rose-500/20 dark:text-rose-100",
};

export function StatusBadge({ status }: { status: AuthStatus }) {
  const Icon = statusIcon[status];
  return (
    <Badge variant="ghost" className={cn("gap-1 font-medium", statusClass[status])}>
      <Icon className="size-3" aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="ghost" className={cn("font-medium", priorityClass[priority])}>
      {priority === "URGENT" ? <OctagonAlert className="size-3" aria-hidden /> : null}
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant="outline">{TASK_STATUS_LABEL[status]}</Badge>;
}

export function AiDisclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 rounded-md border border-ai/25 bg-ai-soft px-3 py-2 text-xs text-foreground", className)}>
      <Sparkles className="size-3.5 shrink-0 text-ai" aria-hidden />
      AI-generated — review before use.
    </p>
  );
}

export const SEVERITY_ICON: Record<AlertSeverity, LucideIcon> = {
  critical: OctagonAlert,
  warning: TriangleAlert,
  info: Info,
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Note",
};

const severityText: Record<AlertSeverity, string> = {
  critical: "text-critical",
  warning: "text-warning",
  info: "text-info",
};

const severityPanel: Record<AlertSeverity, string> = {
  critical: "border-critical/30 bg-critical-soft",
  warning: "border-warning/30 bg-warning-soft",
  info: "border-info/25 bg-info-soft",
};

/** Short names for alert kinds, used where the full message does not fit. */
export const ALERT_SHORT_LABEL: Record<AlertKind, string> = {
  PAYER_OVERDUE: "Payer overdue",
  PAYER_DUE_SOON: "Payer due soon",
  INFO_REQUESTED: "Info requested",
  AUTH_EXPIRING: "Approval expiring",
  AUTH_EXPIRED: "Approval expired",
  SERVICE_OUTSIDE_WINDOW: "Outside window",
  APPEAL_DEADLINE_SOON: "Appeal deadline",
  APPEAL_DEADLINE_PASSED: "Appeal closed",
  URGENT_NOT_SUBMITTED: "Urgent, not sent",
  STALE_INTERNAL: "Stale draft",
  DETERMINATION_LETTER_MISSING: "Letter missing",
};

export function SeverityIcon({ severity, className }: { severity: AlertSeverity; className?: string }) {
  const Icon = SEVERITY_ICON[severity];
  return <Icon className={cn("size-4 shrink-0", severityText[severity], className)} aria-label={SEVERITY_LABEL[severity]} role="img" />;
}

export function AlertBadge({ severity, children }: { severity: AlertSeverity; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium text-foreground", severityPanel[severity])}>
      <SeverityIcon severity={severity} className="size-3.5" />
      {children}
    </span>
  );
}

export function alertPanelClass(severity: AlertSeverity): string {
  return cn("rounded-lg border px-3 py-2 text-sm text-foreground", severityPanel[severity]);
}
