import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDb, resetMemoryStore } from "@/lib/store";
import { parseEligibility, StediAdapter } from "@/lib/integrations/stedi";
import { IntegrationError } from "@/lib/integrations/eligibility";
import { runEligibilityCheck, saveClearinghouse, setAdapterFactoryForTests, testClearinghouse } from "@/lib/services/integrations";
import { AppError } from "@/lib/domain/errors";
import type { RequestContext } from "@/lib/domain/types";

function contextFor(email: string): RequestContext {
  const db = readDb();
  const user = db.users.find((item) => item.email === email)!;
  const membership = db.organizationMembers.find((item) => item.userId === user.id && item.status === "ACTIVE")!;
  return {
    userId: user.id,
    email,
    role: membership.role,
    organizationId: membership.organizationId,
    profile: db.profiles.find((item) => item.id === user.id)!,
    organization: db.organizations.find((item) => item.id === membership.organizationId)!,
  };
}

function caseWithIdentifier(ctx: RequestContext) {
  const db = readDb();
  return db.authorizationCases.find((item) => {
    if (item.organizationId !== ctx.organizationId || !item.memberId) return false;
    return Boolean(db.payers.find((payer) => payer.id === item.payerId)?.identifier);
  })!;
}

beforeEach(() => resetMemoryStore(new Date("2026-09-26T15:00:00.000Z")));
afterEach(() => {
  setAdapterFactoryForTests(null);
  vi.unstubAllGlobals();
});

describe("Stedi mapping (X12 271 as JSON)", () => {
  it("reads active coverage, plan, dates and the prior-auth indicator", () => {
    const result = parseEligibility({
      controlNumber: "123456789",
      planStatus: [{ statusCode: "1", status: "Active Coverage", planDetails: "Gold PPO" }],
      planInformation: { planDescription: "Northwind Gold PPO" },
      planDateInformation: { planBegin: "20260101-20261231" },
      benefitsInformation: [{ code: "1", serviceTypeCodes: ["30"], authOrCertIndicator: "Y" }],
    });
    expect(result).toMatchObject({ status: "ACTIVE", planName: "Northwind Gold PPO", coverageStart: "2026-01-01", coverageEnd: "2026-12-31", authIndicator: "REQUIRED", traceId: "123456789" });
  });

  it("reads inactive coverage and payer errors", () => {
    const result = parseEligibility({ planStatus: [{ statusCode: "6", status: "Inactive" }], errors: [{ code: "72", description: "Invalid/Missing Subscriber/Insured ID" }] });
    expect(result.status).toBe("INACTIVE");
    expect(result.notes[0]).toMatch(/Invalid\/Missing Subscriber/);
  });
});

describe("Stedi adapter calls", () => {
  it("sends the request in X12 formats and retries on 5xx, not on 4xx", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
    let responses = [new Response("{}", { status: 503 }), Response.json({ planStatus: [{ statusCode: "1" }] })];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).authorization) });
      return responses.shift()!;
    });
    const adapter = new StediAdapter("test-key");
    const result = await adapter.checkEligibility({
      payerId: "NWH01",
      provider: { npi: "1234567893", organizationName: "Northstar" },
      subscriber: { firstName: "Ana", lastName: "Reyes", dateOfBirth: "1968-04-12", memberId: "M1" },
      serviceTypeCodes: ["30"],
      dateOfService: "2026-10-01",
    });
    expect(result.status).toBe("ACTIVE");
    expect(result.attempts).toBe(2);
    expect(calls[0].url).toMatch(/\/change\/medicalnetwork\/eligibility\/v3$/);
    expect(calls[0].auth).toBe("test-key");
    expect(calls[0].body).toMatchObject({ tradingPartnerServiceId: "NWH01", subscriber: { dateOfBirth: "19680412" }, encounter: { dateOfService: "20261001", serviceTypeCodes: ["30"] } });
    expect(String(calls[0].body.controlNumber)).toMatch(/^\d{9}$/);

    responses = [Response.json({ message: "Unauthorized" }, { status: 401 })];
    calls.length = 0;
    await expect(adapter.testConnection()).rejects.toThrow(/rejected the API key/);
    expect(calls).toHaveLength(1);
  });
});

describe("eligibility through the integration hub", () => {
  it("works out of the box with the demo simulator and records a result, activity and audit", async () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = caseWithIdentifier(ctx);
    const check = await runEligibilityCheck(ctx, item.id);
    expect(["ACTIVE", "INACTIVE"]).toContain(check.status);
    const db = readDb();
    expect(db.eligibilityChecks.some((row) => row.id === check.id)).toBe(true);
    expect(db.auditEvents.some((event) => event.event === "integration.eligibility_checked")).toBe(true);
    const message = db.integrationMessages.at(-1)!;
    expect(message.outcome).toBe("SUCCESS");
    const patient = db.patients.find((row) => row.id === item.patientId)!;
    expect(JSON.stringify(message)).not.toContain(patient.lastName);
    expect(JSON.stringify(message)).not.toContain(item.memberId);
  });

  it("stores a failed check with a readable reason and marks the connection unhealthy", async () => {
    const ctx = contextFor("specialist@northstar.demo");
    setAdapterFactoryForTests(() => ({
      name: "broken",
      checkEligibility: async () => {
        throw new IntegrationError("The clearinghouse did not respond in time.", null, true, 3);
      },
      testConnection: async () => {},
    }));
    const check = await runEligibilityCheck(ctx, caseWithIdentifier(ctx).id);
    expect(check.status).toBe("ERROR");
    expect(check.errorMessage).toMatch(/did not respond/);
    const endpoint = readDb().integrationEndpoints.find((row) => row.organizationId === ctx.organizationId)!;
    expect(endpoint.lastError).toMatch(/did not respond/);
    expect(readDb().integrationMessages.at(-1)).toMatchObject({ outcome: "FAILED", attempts: 3 });
  });

  it("explains missing prerequisites instead of calling the clearinghouse", async () => {
    const ctx = contextFor("specialist@northstar.demo");
    const item = readDb().authorizationCases.find((row) => row.organizationId === ctx.organizationId)!;
    const called = vi.fn();
    setAdapterFactoryForTests(() => ({ name: "spy", checkEligibility: called, testConnection: async () => {} }));
    const { mutate } = await import("@/lib/store");
    mutate((db) => {
      db.authorizationCases.find((row) => row.id === item.id)!.memberId = "";
    });
    await expect(runEligibilityCheck(ctx, item.id)).rejects.toThrow(/member ID/);
    expect(called).not.toHaveBeenCalled();
  });

  it("requires an API key for a real clearinghouse, stores it encrypted, and limits setup to admins", async () => {
    const admin = contextFor("admin@northstar.demo");
    expect(() => saveClearinghouse(admin, { provider: "stedi", environment: "test", apiKey: "", enabled: true })).toThrow(/API key/);
    saveClearinghouse(admin, { provider: "stedi", environment: "test", apiKey: "sk_test_secret_value", enabled: true });
    const endpoint = readDb().integrationEndpoints.find((row) => row.organizationId === admin.organizationId)!;
    expect(endpoint.provider).toBe("stedi");
    expect(endpoint.secretEncrypted).not.toContain("sk_test_secret_value");
    expect(() => saveClearinghouse(contextFor("specialist@northstar.demo"), { provider: "simulator", environment: "test", apiKey: "", enabled: true })).toThrow(AppError);
    setAdapterFactoryForTests(() => ({ name: "ok", checkEligibility: vi.fn(), testConnection: async () => {} }));
    expect(await testClearinghouse(admin)).toMatchObject({ ok: true });
  });

  it("refuses when no clearinghouse is connected (other organization)", async () => {
    const rival = contextFor("rival@lakeside.demo");
    const item = readDb().authorizationCases.find((row) => row.organizationId === rival.organizationId)!;
    await expect(runEligibilityCheck(rival, item.id)).rejects.toThrow(/not set up/);
  });
});
