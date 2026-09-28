import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { readDb, resetMemoryStore } from "@/lib/store";
import { clearOidcCache } from "@/lib/auth/oidc";
import { addSsoDomain, completeSso, startSso, updateSsoSettings, verifySsoDomain, type SsoSettingsInput } from "@/lib/services/sso";
import { signInWithPassword } from "@/lib/services/auth";
import { resolveSessionForTest } from "@/lib/services/context";
import { DEMO_PASSWORD } from "@/lib/demo/accounts";
import { AppError } from "@/lib/domain/errors";
import type { RequestContext } from "@/lib/domain/types";

const TENANT = "11111111-2222-4333-8444-555555555555";
const OKTA = "https://northstar.okta.test";
const MS = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const GOOGLE = "https://accounts.google.com";

let privateKey: CryptoKey;
let jwk: JWK;
let claimsForNextToken: Record<string, unknown> = {};
let signingIssuer = OKTA;
let signingAudience = "okta-client";

function metadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/keys`,
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
  };
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  process.env.MICROSOFT_CLIENT_ID = "ms-client";
  process.env.MICROSOFT_CLIENT_SECRET = "ms-secret";
  process.env.GOOGLE_CLIENT_ID = "g-client";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    for (const issuer of [OKTA, MS, GOOGLE]) {
      if (url === `${issuer}/.well-known/openid-configuration`) return Response.json(metadata(issuer));
      if (url === `${issuer}/keys`) return Response.json({ keys: [jwk] });
      if (url === `${issuer}/token`) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        if (!body.get("code_verifier")) return new Response("missing verifier", { status: 400 });
        if (!String((init?.headers as Record<string, string>)?.authorization ?? "").startsWith("Basic ")) return new Response("no client auth", { status: 401 });
        const token = await new SignJWT(claimsForNextToken)
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(signingIssuer)
          .setAudience(signingAudience)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        return Response.json({ id_token: token });
      }
    }
    return new Response("not found", { status: 404 });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetMemoryStore(new Date("2026-09-26T15:00:00.000Z"));
  clearOidcCache();
  signingIssuer = OKTA;
  signingAudience = "okta-client";
});

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

async function verifyDomain(ctx: RequestContext, domain: string) {
  const { txtValue } = addSsoDomain(ctx, domain);
  expect(await verifySsoDomain(ctx, domain, async () => [[txtValue]])).toBe(true);
}

async function configure(overrides: Partial<SsoSettingsInput> = {}) {
  const admin = contextFor("admin@northstar.demo");
  await verifyDomain(admin, "northstar.demo");
  updateSsoSettings(admin, {
    enabled: true,
    provider: "oidc",
    tenantId: "",
    issuer: OKTA,
    clientId: "okta-client",
    clientSecret: "okta-secret",
    jitProvisioning: true,
    defaultRole: "SPECIALIST",
    requireSso: false,
    ...overrides,
  });
  return admin;
}

async function signIn(email: string, claims: Record<string, unknown>, tamper: { state?: string; nonce?: string } = {}) {
  const { url, state } = await startSso(email);
  claimsForNextToken = { nonce: tamper.nonce ?? state.nonce, ...claims };
  return { url: new URL(url), result: completeSso(state, { code: "code-1", state: tamper.state ?? state.state }) };
}

describe("domain verification", () => {
  it("refuses public domains, unproven domains and domains another org owns", async () => {
    const admin = contextFor("admin@northstar.demo");
    expect(() => addSsoDomain(admin, "gmail.com")).toThrow(AppError);
    addSsoDomain(admin, "northstar.demo");
    expect(await verifySsoDomain(admin, "northstar.demo", async () => [["healthflow-verification=wrong"]])).toBe(false);
    await verifyDomain(admin, "northstar.demo");
    expect(() => addSsoDomain(contextFor("rival@lakeside.demo"), "northstar.demo")).toThrow(/another organization/);
  });

  it("will not turn SSO on without a verified domain or a valid Microsoft tenant", async () => {
    const admin = contextFor("admin@northstar.demo");
    const base: SsoSettingsInput = { enabled: true, provider: "microsoft", tenantId: TENANT, issuer: "", clientId: "", clientSecret: "", jitProvisioning: true, defaultRole: "VIEWER", requireSso: false };
    expect(() => updateSsoSettings(admin, base)).toThrow(/Verify at least one/);
    await verifyDomain(admin, "northstar.demo");
    expect(() => updateSsoSettings(admin, { ...base, tenantId: "not-a-guid" })).toThrow(/tenant/);
    expect(() => updateSsoSettings(contextFor("specialist@northstar.demo"), base)).toThrow(AppError);
    updateSsoSettings(admin, base);
    expect(readDb().organizations.find((org) => org.id === admin.organizationId)?.sso?.enabled).toBe(true);
  });
});

describe("generic OIDC sign-in", () => {
  it("uses PKCE, state and nonce, provisions a new user, and links the same identity next time", async () => {
    await configure();
    const { url, result } = await signIn("new.person@northstar.demo", { sub: "okta-1", email: "new.person@northstar.demo", email_verified: true, name: "New Person" });
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    const { session } = await result;
    expect(session.amr).toBe("sso");
    const db = readDb();
    const user = db.users.find((item) => item.email === "new.person@northstar.demo")!;
    expect(user.passwordHash).toBe("");
    expect(db.organizationMembers.find((item) => item.userId === user.id)?.role).toBe("SPECIALIST");
    expect(resolveSessionForTest(session)?.email).toBe("new.person@northstar.demo");

    const again = await (await signIn("new.person@northstar.demo", { sub: "okta-1", email: "new.person@northstar.demo", email_verified: true })).result;
    expect(again.session.sub).toBe(user.id);
    expect(readDb().users.filter((item) => item.email === "new.person@northstar.demo")).toHaveLength(1);
    expect(readDb().auditEvents.some((event) => event.event === "sso.user_provisioned")).toBe(true);
  });

  it("links an existing member by verified email without creating a second membership", async () => {
    await configure();
    const before = readDb().organizationMembers.length;
    const { session } = await (await signIn("specialist@northstar.demo", { sub: "okta-2", email: "specialist@northstar.demo", email_verified: true })).result;
    expect(session.sub).toBe(readDb().users.find((item) => item.email === "specialist@northstar.demo")!.id);
    expect(readDb().organizationMembers.length).toBe(before);
  });

  it("rejects replayed nonces, forged state, wrong audience, unverified emails and outside domains", async () => {
    await configure();
    const good = { sub: "okta-3", email: "a@northstar.demo", email_verified: true };
    await expect((await signIn("a@northstar.demo", good, { nonce: "other" })).result).rejects.toThrow(/verified/);
    await expect((await signIn("a@northstar.demo", good, { state: "forged" })).result).rejects.toThrow(/does not match/);
    signingAudience = "someone-else";
    await expect((await signIn("a@northstar.demo", good)).result).rejects.toThrow(AppError);
    signingAudience = "okta-client";
    await expect((await signIn("a@northstar.demo", { ...good, email_verified: false })).result).rejects.toThrow(/did not confirm/);
    await expect((await signIn("a@northstar.demo", { ...good, email: "a@elsewhere.example" })).result).rejects.toThrow(/not verified/);
    await expect(completeSso(null, { code: "c", state: "s" })).rejects.toThrow(/expired/);
    expect(readDb().auditEvents.filter((event) => event.event === "sso.login_failed").length).toBeGreaterThanOrEqual(4);
  });

  it("refuses unknown people when automatic accounts are off", async () => {
    await configure({ jitProvisioning: false });
    await expect((await signIn("stranger@northstar.demo", { sub: "okta-9", email: "stranger@northstar.demo", email_verified: true })).result).rejects.toThrow(/invite/);
  });

  it("does not start SSO for domains without it", async () => {
    await expect(startSso("someone@gmail.com")).rejects.toThrow(/not set up/);
  });
});

describe("Microsoft and Google rules", () => {
  it("accepts only the organization's Entra tenant and keys the account on tenant + object ID", async () => {
    await configure({ provider: "microsoft", tenantId: TENANT, issuer: "", clientId: "", clientSecret: "" });
    signingIssuer = MS;
    signingAudience = "ms-client";
    await expect((await signIn("x@northstar.demo", { tid: "99999999-2222-4333-8444-555555555555", oid: "o1", preferred_username: "x@northstar.demo" })).result).rejects.toThrow(/different directory/);
    const { session } = await (await signIn("x@northstar.demo", { tid: TENANT, oid: "o1", preferred_username: "x@northstar.demo", name: "X" })).result;
    expect(readDb().users.find((item) => item.id === session.sub)?.identities[0].key).toBe(`microsoft:${TENANT}:o1`);
  });

  it("refuses personal Google accounts and sends the hosted-domain hint", async () => {
    await configure({ provider: "google", issuer: "", clientId: "", clientSecret: "" });
    signingIssuer = GOOGLE;
    signingAudience = "g-client";
    const personal = await signIn("y@northstar.demo", { sub: "g1", email: "y@gmail.com", email_verified: true });
    expect(personal.url.searchParams.get("hd")).toBe("northstar.demo");
    await expect(personal.result).rejects.toThrow(/Google Workspace/);
    const { session } = await (await signIn("y@northstar.demo", { sub: "g1", email: "y@northstar.demo", email_verified: true, hd: "northstar.demo" })).result;
    expect(session.amr).toBe("sso");
  });
});

describe("Require SSO", () => {
  it("blocks member passwords and password sessions but keeps owner break-glass", async () => {
    const manager = signInWithPassword("manager@northstar.demo", DEMO_PASSWORD);
    await configure({ requireSso: true });
    if (manager.kind === "session") expect(resolveSessionForTest(manager.session)).toBeNull();
    expect(() => signInWithPassword("specialist@northstar.demo", DEMO_PASSWORD)).toThrow(/signs in with SSO/);
    const owner = signInWithPassword("owner@northstar.demo", DEMO_PASSWORD);
    expect(owner.kind).toBe("session");
    if (owner.kind === "session") expect(resolveSessionForTest(owner.session)).not.toBeNull();
    expect(readDb().auditEvents.some((event) => event.event === "auth.break_glass_login")).toBe(true);
    const { session } = await (await signIn("specialist@northstar.demo", { sub: "okta-5", email: "specialist@northstar.demo", email_verified: true })).result;
    expect(resolveSessionForTest(session)?.role).toBe("SPECIALIST");
  });

  it("keeps the client secret encrypted", async () => {
    await configure();
    const stored = readDb().organizations.find((org) => org.sso)?.sso?.clientSecretEncrypted ?? "";
    expect(stored).not.toContain("okta-secret");
    expect(stored.length).toBeGreaterThan(20);
  });
});
