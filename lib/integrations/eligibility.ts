/**
 * Vendor-neutral eligibility contract. Each clearinghouse adapter turns this request into its own
 * API call (X12 270 underneath) and maps the reply (X12 271) back into EligibilityResult.
 */

export interface EligibilityRequest {
  /** Payer's electronic ID at the clearinghouse (the payer's "Payer ID" in HealthFlow). */
  payerId: string;
  provider: { npi: string; organizationName: string };
  subscriber: { firstName: string; lastName: string; dateOfBirth: string; memberId: string };
  /** X12 service type codes. "30" = health benefit plan coverage (general). */
  serviceTypeCodes: string[];
  /** Service date, YYYY-MM-DD. */
  dateOfService: string;
}

export interface EligibilityResult {
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  planName: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  authIndicator: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN";
  notes: string[];
  traceId: string;
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly retryable: boolean,
    readonly attempts = 1,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export interface ClearinghouseAdapter {
  readonly name: string;
  checkEligibility(request: EligibilityRequest): Promise<EligibilityResult & { attempts: number; httpStatus: number | null }>;
  /** Cheap authenticated call used by "Test connection". */
  testConnection(): Promise<void>;
}

/** YYYY-MM-DD -> YYYYMMDD, the X12 date format most clearinghouse APIs use. */
export function x12Date(value: string): string {
  return value.replaceAll("-", "");
}

/** YYYYMMDD -> YYYY-MM-DD; null when the value isn't a date. */
export function isoFromX12(value: unknown): string | null {
  const text = typeof value === "string" ? value : "";
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
