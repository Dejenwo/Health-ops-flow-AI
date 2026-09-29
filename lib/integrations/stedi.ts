import { randomInt } from "crypto";
import { IntegrationError, isoFromX12, x12Date, type ClearinghouseAdapter, type EligibilityRequest } from "@/lib/integrations/eligibility";

/**
 * Stedi real-time eligibility (JSON in front of X12 270/271).
 * Endpoint and field names follow Stedi's published eligibility API. Verify against the current
 * docs when you first connect a sandbox key; the mapping is isolated in this file for that reason.
 */
const DEFAULT_BASE = "https://healthcare.us.stedi.com/2024-04-01";
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

type Json = Record<string, unknown>;

function baseUrl(): string {
  return (process.env.STEDI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as Json[]) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class StediAdapter implements ClearinghouseAdapter {
  readonly name = "stedi";

  constructor(private readonly apiKey: string) {}

  private async post(path: string, body: Json): Promise<{ json: Json; attempts: number; status: number }> {
    let lastError: IntegrationError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl()}${path}`, {
          method: "POST",
          headers: { authorization: this.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        lastError = new IntegrationError("The clearinghouse did not respond in time.", null, true, attempt);
        if (attempt < MAX_ATTEMPTS) await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      const json = (await response.json().catch(() => ({}))) as Json;
      if (response.ok) return { json, attempts: attempt, status: response.status };
      const retryable = response.status === 429 || response.status >= 500;
      const detail = text(json.message) || text((json.errors as Json[] | undefined)?.[0]?.description);
      lastError = new IntegrationError(
        response.status === 401 || response.status === 403
          ? "The clearinghouse rejected the API key."
          : `The clearinghouse returned an error (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
        response.status,
        retryable,
        attempt,
      );
      if (!retryable) throw lastError;
      if (attempt < MAX_ATTEMPTS) await sleep(250 * 2 ** (attempt - 1));
    }
    throw lastError ?? new IntegrationError("The clearinghouse request failed.", null, true, MAX_ATTEMPTS);
  }

  async checkEligibility(request: EligibilityRequest) {
    const body: Json = {
      // Control number: 9 digits, unique per request, used to match the reply.
      controlNumber: String(randomInt(100_000_000, 999_999_999)),
      tradingPartnerServiceId: request.payerId,
      provider: { organizationName: request.provider.organizationName, npi: request.provider.npi },
      subscriber: {
        firstName: request.subscriber.firstName,
        lastName: request.subscriber.lastName,
        dateOfBirth: x12Date(request.subscriber.dateOfBirth),
        memberId: request.subscriber.memberId,
      },
      encounter: { serviceTypeCodes: request.serviceTypeCodes, dateOfService: x12Date(request.dateOfService) },
    };
    const { json, attempts, status } = await this.post("/change/medicalnetwork/eligibility/v3", body);
    return { ...parseEligibility(json), attempts, httpStatus: status };
  }

  async testConnection() {
    // An eligibility call against Stedi's test payer returns 200 for a valid key.
    await this.post("/change/medicalnetwork/eligibility/v3", {
      controlNumber: "123456789",
      tradingPartnerServiceId: "STEDITEST",
      provider: { organizationName: "HealthFlow connection test", npi: "1999999984" },
      subscriber: { firstName: "Test", lastName: "Connection", dateOfBirth: "19800101", memberId: "0000000000" },
      encounter: { serviceTypeCodes: ["30"] },
    });
  }
}

/** Maps the JSON form of an X12 271 into the fields HealthFlow keeps. Exported for tests. */
export function parseEligibility(json: Json) {
  const errors = list(json.errors);
  const planStatus = list(json.planStatus);
  const benefits = list(json.benefitsInformation);
  const statusCodes = planStatus.map((item) => text(item.statusCode));
  const benefitCodes = benefits.map((item) => text(item.code));
  const active = statusCodes.includes("1") || benefitCodes.includes("1");
  const inactive = !active && (statusCodes.some((code) => ["6", "7", "8"].includes(code)) || benefitCodes.some((code) => ["6", "7", "8"].includes(code)));
  // authOrCertIndicator: "Y" = prior authorization/certification required, "N" = not required.
  const indicators = benefits.map((item) => text(item.authOrCertIndicator)).filter(Boolean);
  const authIndicator = indicators.includes("Y") ? "REQUIRED" : indicators.includes("N") ? "NOT_REQUIRED" : "UNKNOWN";
  const planInfo = (json.planInformation ?? {}) as Json;
  const dates = (json.planDateInformation ?? {}) as Json;
  const planName = text(planInfo.planDescription) || text(planInfo.groupDescription) || text(planStatus[0]?.planDetails) || "";
  const [startRaw, endRaw] = text(dates.planBegin || dates.eligibilityBegin || dates.plan).split("-");
  const notes = [
    ...errors.map((item) => `Payer: ${text(item.description) || text(item.code) || "error"}`),
    ...planStatus.map((item) => text(item.status)).filter(Boolean),
  ].slice(0, 10);
  return {
    status: (active ? "ACTIVE" : inactive ? "INACTIVE" : "UNKNOWN") as "ACTIVE" | "INACTIVE" | "UNKNOWN",
    planName: planName.slice(0, 200),
    coverageStart: isoFromX12(startRaw),
    coverageEnd: isoFromX12(endRaw ?? text(dates.planEnd)),
    authIndicator: authIndicator as "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN",
    notes,
    traceId: text(json.controlNumber) || text((json.meta as Json | undefined)?.traceId),
  };
}
