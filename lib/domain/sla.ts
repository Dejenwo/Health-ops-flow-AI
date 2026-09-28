import type { AuthorizationCase, Payer, PayerType, ReviewType } from "@/lib/domain/types";
import { AWAITING_PAYER, TERMINAL_STATUSES } from "@/lib/domain/transitions";
import { addDaysISO, calendarDaysBetween, todayISO } from "@/lib/format";

/**
 * Starting points for payer timeframes. Organizations must confirm them against each payer
 * contract and the rules that apply to them (for example CMS-0057-F for Medicare Advantage and
 * Medicaid managed care, ERISA claims rules for employer plans, and state workers' comp rules).
 * They are editable per payer. They are operational defaults, not legal guidance.
 */
export const PAYER_TIMEFRAME_DEFAULTS: Record<PayerType, Pick<Payer, "standardTurnaroundDays" | "expeditedTurnaroundHours" | "appealWindowDays">> = {
  MEDICARE_ADVANTAGE: { standardTurnaroundDays: 7, expeditedTurnaroundHours: 72, appealWindowDays: 65 },
  MEDICAID_MANAGED: { standardTurnaroundDays: 7, expeditedTurnaroundHours: 72, appealWindowDays: 60 },
  COMMERCIAL: { standardTurnaroundDays: 15, expeditedTurnaroundHours: 72, appealWindowDays: 180 },
  WORKERS_COMP: { standardTurnaroundDays: 14, expeditedTurnaroundHours: 72, appealWindowDays: 30 },
  OTHER: { standardTurnaroundDays: 15, expeditedTurnaroundHours: 72, appealWindowDays: 60 },
};

export const DUE_SOON_HOURS = 24;
export const EXPIRING_WITHIN_DAYS = 14;
export const APPEAL_WARNING_DAYS = 10;
export const STALE_INTERNAL_DAYS = 3;

type PayerClock = Pick<Payer, "standardTurnaroundDays" | "expeditedTurnaroundHours">;

/** When the payer's decision is due for a submission made at `submittedAt`. */
export function computePayerDueAt(submittedAt: string, reviewType: ReviewType, payer: PayerClock): string {
  const start = new Date(submittedAt).getTime();
  const ms =
    reviewType === "EXPEDITED"
      ? payer.expeditedTurnaroundHours * 3_600_000
      : payer.standardTurnaroundDays * 86_400_000;
  return new Date(start + ms).toISOString();
}

export function computeAppealDeadline(decisionDate: string, appealWindowDays: number): string {
  return addDaysISO(decisionDate.slice(0, 10), appealWindowDays);
}

export type AlertKind =
  | "PAYER_OVERDUE"
  | "PAYER_DUE_SOON"
  | "INFO_REQUESTED"
  | "AUTH_EXPIRING"
  | "AUTH_EXPIRED"
  | "SERVICE_OUTSIDE_WINDOW"
  | "APPEAL_DEADLINE_SOON"
  | "APPEAL_DEADLINE_PASSED"
  | "URGENT_NOT_SUBMITTED"
  | "STALE_INTERNAL"
  | "DETERMINATION_LETTER_MISSING";

export type AlertSeverity = "critical" | "warning" | "info";

export interface CaseAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 3, warning: 2, info: 1 };

export function serviceDateInWindow(item: Pick<AuthorizationCase, "requestedServiceDate" | "validFrom" | "validTo">): boolean {
  if (!item.validFrom || !item.validTo || !item.requestedServiceDate) return true;
  return item.requestedServiceDate >= item.validFrom && item.requestedServiceDate <= item.validTo;
}

/** Operational alerts for one case. Pure function so the dashboard, queue and tests agree. */
export function caseAlerts(item: AuthorizationCase, now = new Date()): CaseAlert[] {
  const alerts: CaseAlert[] = [];
  if (TERMINAL_STATUSES.has(item.status)) return alerts;
  const today = todayISO(now);

  if (AWAITING_PAYER.has(item.status) && item.payerDueAt) {
    const hoursLeft = (new Date(item.payerDueAt).getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft < 0) {
      alerts.push({
        kind: "PAYER_OVERDUE",
        severity: "critical",
        message: `Payer decision was due ${Math.ceil(-hoursLeft / 24)} day(s) ago. Escalate with the payer.`,
      });
    } else if (hoursLeft <= DUE_SOON_HOURS) {
      alerts.push({ kind: "PAYER_DUE_SOON", severity: "warning", message: "Payer decision is due within 24 hours." });
    }
  }

  if (item.status === "ADDITIONAL_INFORMATION_REQUESTED") {
    alerts.push({ kind: "INFO_REQUESTED", severity: "warning", message: "The payer is waiting on information from us." });
  }

  if ((item.status === "APPROVED" || item.status === "PARTIALLY_APPROVED") && item.validTo) {
    const daysLeft = calendarDaysBetween(today, item.validTo);
    if (daysLeft < 0) {
      alerts.push({ kind: "AUTH_EXPIRED", severity: "critical", message: "Authorization window has ended. Close the case or request an extension." });
    } else if (daysLeft <= EXPIRING_WITHIN_DAYS) {
      alerts.push({ kind: "AUTH_EXPIRING", severity: "warning", message: `Authorization expires in ${daysLeft} day(s).` });
    }
  }

  if ((item.status === "APPROVED" || item.status === "PARTIALLY_APPROVED") && !serviceDateInWindow(item)) {
    alerts.push({
      kind: "SERVICE_OUTSIDE_WINDOW",
      severity: "critical",
      message: "Scheduled service date falls outside the approved window. Reschedule or request an update before service.",
    });
  }

  if ((item.status === "DENIED" || item.status === "PARTIALLY_APPROVED") && item.appealDeadline && !item.appealSubmittedAt) {
    const daysLeft = calendarDaysBetween(today, item.appealDeadline);
    if (daysLeft < 0) {
      alerts.push({ kind: "APPEAL_DEADLINE_PASSED", severity: "info", message: "The appeal window has closed." });
    } else if (daysLeft <= APPEAL_WARNING_DAYS) {
      alerts.push({ kind: "APPEAL_DEADLINE_SOON", severity: "critical", message: `Appeal deadline in ${daysLeft} day(s).` });
    }
  }

  if (item.priority === "URGENT" && ["DRAFT", "NEEDS_INFORMATION", "READY_FOR_REVIEW"].includes(item.status)) {
    alerts.push({ kind: "URGENT_NOT_SUBMITTED", severity: "critical", message: "Urgent request has not been submitted yet." });
  }

  if (["DRAFT", "NEEDS_INFORMATION"].includes(item.status)) {
    const idleDays = (now.getTime() - new Date(item.updatedAt).getTime()) / 86_400_000;
    if (idleDays > STALE_INTERNAL_DAYS) {
      alerts.push({ kind: "STALE_INTERNAL", severity: "warning", message: `No internal progress for ${Math.floor(idleDays)} days.` });
    }
  }

  if (item.decisionOutcome && !item.determinationDocumentId && item.status !== "CLOSED") {
    alerts.push({ kind: "DETERMINATION_LETTER_MISSING", severity: "info", message: "Attach the payer determination letter." });
  }

  return alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export function topSeverity(alerts: CaseAlert[]): AlertSeverity | null {
  return alerts[0]?.severity ?? null;
}

/** Starting point for appeal decision timeframes (pre-service reconsiderations). Editable per organization policy. */
export const APPEAL_DECISION_DAYS = 30;

export function computeAppealDueAt(filedAt: string, reviewType: ReviewType, payer: Pick<Payer, "expeditedTurnaroundHours">): string {
  const start = new Date(filedAt).getTime();
  const ms = reviewType === "EXPEDITED" ? payer.expeditedTurnaroundHours * 3_600_000 : APPEAL_DECISION_DAYS * 86_400_000;
  return new Date(start + ms).toISOString();
}
