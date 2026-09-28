import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { readDb, resetMemoryStore } from "@/lib/store";
import { checkSession, signSession, type SessionPayload } from "@/lib/auth/session-token";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { base32Encode, totpAt, verifyTotp, currentStep } from "@/lib/auth/totp";
import { openBytes, openSecret, sealBytes, sealSecret } from "@/lib/security/crypto";
import { productionConfigProblems } from "@/lib/config";
import { migrateDatabase } from "@/lib/store/migrate";
import { resolveSessionForTest } from "@/lib/services/context";
import {
  beginMfaEnrollment,
  changePassword,
  confirmMfaEnrollment,
  requestPasswordReset,
  revokeAllSessions,
  signInWithPassword,
  verifyMfaChallengeCode,
} from "@/lib/services/auth";
import { updateOrganizationSecurity } from "@/lib/services/admin";
import { DEMO_PASSWORD } from "@/lib/demo/accounts";
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

function signIn(email: string): SessionPayload {
  const result = signInWithPassword(email, DEMO_PASSWORD);
  if (result.kind !== "session") throw new Error("expected session");
  return result.session;
}

beforeEach(() => resetMemoryStore(new Date("2026-09-26T15:00:00.000Z")));

describe("sessions", () => {
  it("expires on inactivity and at the absolute limit, and rejects tampering", () => {
    const session = signIn("specialist@northstar.demo");
    const token = signSession(session);
    expect(checkSession(token, session.last + 60_000).ok).toBe(true);
    expect(checkSession(token, session.last + session.idle * 60_000 + 1)).toEqual({ ok: false, reason: "idle" });
    expect(checkSession(signSession({ ...session, last: session.exp }), session.exp + 1)).toEqual({ ok: false, reason: "expired" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...session, role: "OWNER" })).toString("base64url");
    expect(checkSession(`${forged}.${sig}`).ok).toBe(false);
    expect(checkSession(`${body}.${sig}.x`).ok).toBe(false);
  });

  it("revokes every session after sign-out-everywhere and password change", () => {
    const first = signIn("manager@northstar.demo");
    expect(resolveSessionForTest(first)).not.toBeNull();
    revokeAllSessions(contextFor("manager@northstar.demo"));
    expect(resolveSessionForTest(first)).toBeNull();
    const second = signIn("manager@northstar.demo");
    const fresh = changePassword(contextFor("manager@northstar.demo"), DEMO_PASSWORD, "a much longer passphrase");
    expect(resolveSessionForTest(second)).toBeNull();
    expect(resolveSessionForTest(fresh)).not.toBeNull();
  });

  it("does not trust the role in the cookie", () => {
    const session = signIn("viewer@northstar.demo");
    expect(resolveSessionForTest({ ...session, role: "OWNER" })?.role).toBe("VIEWER");
  });
});

describe("passwords", () => {
  it("uses the stronger scrypt format and upgrades legacy hashes at sign-in", () => {
    const hash = hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(verifyPassword("correct horse battery", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash("scrypt$abcd$ef01")).toBe(true);
  });

  it("does not reveal whether an email is registered", async () => {
    await expect(requestPasswordReset("nobody@example.com")).resolves.toEqual({ demoResetPath: null });
    const known = await requestPasswordReset("viewer@northstar.demo");
    expect(known.demoResetPath).toMatch(/^\/reset-password\?token=/);
  });
});

describe("two-factor sign-in", () => {
  it("matches the RFC 6238 test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });

  it("enrolls, challenges, blocks replay and accepts a recovery code once", () => {
    const ctx = contextFor("specialist@northstar.demo");
    const { secret } = beginMfaEnrollment(ctx);
    const code = totpAt(secret, currentStep());
    const { recoveryCodes } = confirmMfaEnrollment(ctx, code);
    expect(recoveryCodes).toHaveLength(8);
    const stored = readDb().users.find((user) => user.id === ctx.userId)!;
    expect(stored.mfaSecretEncrypted).not.toContain(secret);
    expect(openSecret(stored.mfaSecretEncrypted!)).toBe(secret);

    const challenge = signInWithPassword(ctx.email, DEMO_PASSWORD);
    expect(challenge.kind).toBe("mfa");
    if (challenge.kind !== "mfa") return;
    expect(() => verifyMfaChallengeCode(challenge.challenge, code)).toThrow();
    const next = totpAt(secret, currentStep() + 1);
    expect(verifyMfaChallengeCode(challenge.challenge, next).sub).toBe(ctx.userId);
    expect(verifyMfaChallengeCode(challenge.challenge, recoveryCodes[0]).sub).toBe(ctx.userId);
    expect(() => verifyMfaChallengeCode(challenge.challenge, recoveryCodes[0])).toThrow();
    expect(verifyTotp(secret, "000000", Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("forces enrollment when the organization requires MFA", () => {
    const admin = contextFor("admin@northstar.demo");
    const before = signIn("viewer@northstar.demo");
    updateOrganizationSecurity(admin, { requireMfa: true, idleTimeoutMinutes: 10 });
    expect(resolveSessionForTest(before)).toBeNull();
    const after = signIn("viewer@northstar.demo");
    expect(after.mfaEnroll).toBe(true);
    expect(after.idle).toBe(10);
  });
});

describe("encryption at rest", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  afterEach(() => {
    delete process.env.HF_DATA_KEY;
  });

  it("round-trips and detects tampering", () => {
    process.env.HF_DATA_KEY = key;
    const sealed = sealBytes(Buffer.from("PHI payload"), "store");
    expect(sealed.includes(Buffer.from("PHI payload"))).toBe(false);
    expect(openBytes(sealed, "store").toString()).toBe("PHI payload");
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => openBytes(tampered, "store")).toThrow();
    expect(() => openBytes(sealed, "blob")).toThrow();
    expect(openSecret(sealSecret("totp-seed"))).toBe("totp-seed");
  });

  it("writes an encrypted, migrated file store", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hf-store-"));
    process.env.HF_DATA_KEY = key;
    process.env.HF_DATA_DIR = dir;
    process.env.HF_STORE = "file";
    vi.resetModules();
    try {
      const store = await import("@/lib/store");
      const db = store.readDb();
      expect(db.users.length).toBeGreaterThan(0);
      store.mutate((draft) => {
        draft.contactRequests.push({ id: "c1", name: "N", email: "n@example.com", organization: "O", message: "Hello there", createdAt: "x" });
      });
      const raw = readFileSync(path.join(dir, "store.json"));
      expect(raw.subarray(0, 7).toString()).toBe("HFENC1:");
      expect(raw.includes(Buffer.from("owner@northstar.demo"))).toBe(false);
    } finally {
      process.env.HF_STORE = "memory";
      delete process.env.HF_DATA_DIR;
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("configuration and upgrades", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("refuses unsafe production settings", () => {
    const problems = productionConfigProblems({ NODE_ENV: "production", VERCEL: "1", AI_PROVIDER: "anthropic", HF_DEMO_MODE: "true" } as NodeJS.ProcessEnv);
    expect(problems.join(" ")).toMatch(/SESSION_SECRET/);
    expect(problems.join(" ")).toMatch(/HF_DATA_KEY/);
    expect(problems.join(" ")).toMatch(/Serverless/);
    expect(problems.join(" ")).toMatch(/BAA/);
    expect(problems.join(" ")).toMatch(/HF_DEMO_MODE/);
    const good = productionConfigProblems({
      NODE_ENV: "production",
      SESSION_SECRET: "x".repeat(48),
      HF_DATA_KEY: key,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      RESEND_API_KEY: "re_x",
      EMAIL_FROM: "no-reply@example.com",
    } as NodeJS.ProcessEnv);
    expect(good).toEqual([]);
  });

  it("migrates a v1 data file", () => {
    const v1 = {
      users: [{ id: "u", email: "a@b.c", passwordHash: "x", createdAt: "", updatedAt: "" }],
      organizations: [{ id: "o", name: "O" }],
      payers: [{ id: "p", type: "MEDICARE_ADVANTAGE" }],
      authorizationCases: [
        { id: "c", organizationId: "o", status: "APPROVED", procedure: "MRI", procedureCode: "72148", diagnosisCode: "M54.5", diagnosisDescription: "LBP", expirationDate: "2026-12-01", priority: "URGENT", decisionDate: "2026-09-01T00:00:00Z" },
      ],
    };
    const { db, migrated } = migrateDatabase(v1);
    expect(migrated).toBe(true);
    const item = db.authorizationCases[0];
    expect(item.lines[0].code).toBe("72148");
    expect(item.diagnoses[0].code).toBe("M54.5");
    expect(item.validTo).toBe("2026-12-01");
    expect(item.decisionOutcome).toBe("APPROVED");
    expect(item.reviewType).toBe("EXPEDITED");
    expect(db.payers[0].standardTurnaroundDays).toBe(7);
    expect(db.users[0].sessionVersion).toBe(1);
    expect(db.organizations[0].caseSequence).toBe(5001);
    expect("procedureCode" in item).toBe(false);
    expect(() => migrateDatabase({ schemaVersion: 99 })).toThrow();
  });
});
