import type { AuthStatus, DecisionOutcome } from "@/lib/domain/types";
import { validationError } from "@/lib/domain/errors";

/**
 * Server-enforced prior-authorization state machine.
 * Anything not listed fails. The same table is enforced in Postgres by
 * `enforce_authorization_rules()` (supabase/migrations/20260927120000_workflow_hardening.sql).
 * Keep the two in sync; tests/unit/domain.test.ts compares them.
 */
export const ALLOWED_TRANSITIONS: Record<AuthStatus, readonly AuthStatus[]> = {
  DRAFT: ["NEEDS_INFORMATION", "READY_FOR_REVIEW", "WITHDRAWN"],
  NEEDS_INFORMATION: ["DRAFT", "READY_FOR_REVIEW", "WITHDRAWN"],
  READY_FOR_REVIEW: ["NEEDS_INFORMATION", "SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["PENDING", "ADDITIONAL_INFORMATION_REQUESTED", "APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN"],
  PENDING: ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "ADDITIONAL_INFORMATION_REQUESTED", "WITHDRAWN"],
  ADDITIONAL_INFORMATION_REQUESTED: ["READY_FOR_REVIEW", "WITHDRAWN"],
  APPROVED: ["CLOSED"],
  PARTIALLY_APPROVED: ["APPEALED", "CLOSED"],
  DENIED: ["APPEALED", "CLOSED"],
  APPEALED: ["PENDING", "APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN", "CLOSED"],
  WITHDRAWN: [],
  CLOSED: [],
};

/** Statuses that can only be entered by recording a payer decision with its evidence. */
export const DECISION_STATUSES: ReadonlySet<AuthStatus> = new Set<DecisionOutcome>([
  "APPROVED",
  "PARTIALLY_APPROVED",
  "DENIED",
]);

/** Once a request leaves the building, its clinical content is frozen. */
export const LOCKED_STATUSES: ReadonlySet<AuthStatus> = new Set<AuthStatus>([
  "SUBMITTED",
  "PENDING",
  "ADDITIONAL_INFORMATION_REQUESTED",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "DENIED",
  "APPEALED",
  "WITHDRAWN",
  "CLOSED",
]);

export const TERMINAL_STATUSES: ReadonlySet<AuthStatus> = new Set<AuthStatus>(["WITHDRAWN", "CLOSED"]);

/** Statuses where the payer holds the case and its decision clock is running. */
export const AWAITING_PAYER: ReadonlySet<AuthStatus> = new Set<AuthStatus>(["SUBMITTED", "PENDING", "APPEALED"]);

/** Statuses that require the readiness checklist to pass before entry. */
export const READINESS_GATED: ReadonlySet<AuthStatus> = new Set<AuthStatus>(["READY_FOR_REVIEW", "SUBMITTED"]);

export function canTransition(from: AuthStatus, to: AuthStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AuthStatus, to: AuthStatus): void {
  if (from === to) {
    throw validationError("The case is already in that status.");
  }
  if (!canTransition(from, to)) {
    throw validationError(`Cannot move a case from ${from} to ${to}.`);
  }
}

/** Next statuses reachable through a plain status change (decisions excluded). */
export function nextStatuses(from: AuthStatus): AuthStatus[] {
  return ALLOWED_TRANSITIONS[from].filter((status) => !DECISION_STATUSES.has(status));
}

/** Whether the decision workflow is available from this status. */
export function canRecordDecision(from: AuthStatus): boolean {
  return ALLOWED_TRANSITIONS[from].some((status) => DECISION_STATUSES.has(status));
}

export function isLocked(status: AuthStatus): boolean {
  return LOCKED_STATUSES.has(status);
}
