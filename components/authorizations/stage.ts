import type { AuthStatus } from "@/lib/domain/types";

/**
 * Presentation-only grouping of the real statuses into the stages a person thinks in.
 * The rules themselves live in lib/domain/transitions.ts; this never decides what is allowed.
 */
export type StageKey = "prepare" | "review" | "payer" | "decision" | "appeal" | "closed";

export interface Stage {
  key: StageKey;
  label: string;
}

const STAGE_OF: Record<AuthStatus, StageKey> = {
  DRAFT: "prepare",
  NEEDS_INFORMATION: "prepare",
  READY_FOR_REVIEW: "review",
  SUBMITTED: "payer",
  PENDING: "payer",
  ADDITIONAL_INFORMATION_REQUESTED: "payer",
  APPROVED: "decision",
  PARTIALLY_APPROVED: "decision",
  DENIED: "decision",
  APPEALED: "appeal",
  WITHDRAWN: "closed",
  CLOSED: "closed",
};

const LABEL: Record<StageKey, string> = {
  prepare: "Prepare",
  review: "Review",
  payer: "With payer",
  decision: "Decision",
  appeal: "Appeal",
  closed: "Closed",
};

export interface StageView {
  stages: Stage[];
  currentIndex: number;
  /** Withdrawn cases stop where they were rather than showing as completed. */
  stopped: boolean;
  /** The payer is waiting on us rather than the other way round. */
  waitingOnUs: boolean;
}

/**
 * @param wasAppealed true when the case has an appeal on record, so the Appeal step is shown
 *   even after the case moves on to a new decision or is closed.
 */
export function stageView(status: AuthStatus, wasAppealed: boolean, stoppedAt?: AuthStatus | null): StageView {
  const showAppeal = wasAppealed || status === "APPEALED";
  const keys: StageKey[] = ["prepare", "review", "payer", "decision", ...(showAppeal ? (["appeal"] as StageKey[]) : []), "closed"];
  const stages = keys.map((key) => ({ key, label: LABEL[key] }));
  if (status === "WITHDRAWN") {
    const at = stoppedAt ? STAGE_OF[stoppedAt] : "prepare";
    const index = Math.max(0, keys.indexOf(at === "closed" ? "prepare" : at));
    return { stages, currentIndex: index, stopped: true, waitingOnUs: false };
  }
  let key = STAGE_OF[status];
  // After an appeal, a new payer decision sits in the Appeal step.
  if (showAppeal && key === "decision" && wasAppealed) key = "appeal";
  return {
    stages,
    currentIndex: keys.indexOf(key),
    stopped: false,
    waitingOnUs: status === "ADDITIONAL_INFORMATION_REQUESTED",
  };
}
