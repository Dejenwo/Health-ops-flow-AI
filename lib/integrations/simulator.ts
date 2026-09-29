import { randomUUID } from "crypto";
import type { ClearinghouseAdapter, EligibilityRequest } from "@/lib/integrations/eligibility";

/**
 * Deterministic stand-in for a clearinghouse, for demos and training. It never contacts anyone.
 * Member IDs ending in 0 come back inactive; ending in 9 simulate a payer timeout; ending in 5 say
 * the plan requires prior auth. Everything else is active with no auth indicator.
 */
export class SimulatorAdapter implements ClearinghouseAdapter {
  readonly name = "simulator";

  async checkEligibility(request: EligibilityRequest) {
    const last = request.subscriber.memberId.trim().slice(-1);
    if (last === "9") {
      const { IntegrationError } = await import("@/lib/integrations/eligibility");
      throw new IntegrationError("Simulated payer timeout.", 504, true, 3);
    }
    const year = request.dateOfService.slice(0, 4);
    return {
      status: last === "0" ? ("INACTIVE" as const) : ("ACTIVE" as const),
      planName: last === "0" ? "Coverage terminated (simulated)" : "Simulated PPO plan",
      coverageStart: `${year}-01-01`,
      coverageEnd: last === "0" ? `${year}-03-31` : `${year}-12-31`,
      authIndicator: last === "5" ? ("REQUIRED" as const) : ("UNKNOWN" as const),
      notes: ["Simulated response. No payer was contacted."],
      traceId: `sim-${randomUUID().slice(0, 8)}`,
      attempts: 1,
      httpStatus: 200,
    };
  }

  async testConnection() {}
}
