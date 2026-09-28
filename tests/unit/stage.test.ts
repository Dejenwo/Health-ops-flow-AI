import { describe, expect, it } from "vitest";
import { stageView } from "@/components/authorizations/stage";
import { AUTH_STATUSES } from "@/lib/domain/types";

describe("stage tracker mapping", () => {
  it("maps every status to a stage", () => {
    for (const status of AUTH_STATUSES) {
      const view = stageView(status, false);
      expect(view.currentIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses five steps normally and six once appealed", () => {
    expect(stageView("PENDING", false).stages.map((stage) => stage.label)).toEqual(["Prepare", "Review", "With payer", "Decision", "Closed"]);
    expect(stageView("APPEALED", false).stages).toHaveLength(6);
    expect(stageView("APPEALED", false).stages[stageView("APPEALED", false).currentIndex].label).toBe("Appeal");
  });

  it("marks information requests as waiting on us and withdrawals as stopped", () => {
    expect(stageView("ADDITIONAL_INFORMATION_REQUESTED", false)).toMatchObject({ waitingOnUs: true, currentIndex: 2 });
    const withdrawn = stageView("WITHDRAWN", false, "PENDING");
    expect(withdrawn.stopped).toBe(true);
    expect(withdrawn.stages[withdrawn.currentIndex].label).toBe("With payer");
    expect(stageView("CLOSED", false).stopped).toBe(false);
  });

  it("puts a decision made on appeal in the Appeal step", () => {
    const view = stageView("APPROVED", true);
    expect(view.stages[view.currentIndex].label).toBe("Appeal");
  });
});
