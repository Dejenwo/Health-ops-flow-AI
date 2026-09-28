import { beforeEach, describe, expect, it } from "vitest";
import { readDb, resetMemoryStore } from "@/lib/store";
import { handleScim, revokeScimToken, rotateScimToken, type ScimRequest } from "@/lib/services/scim";
import { addSsoDomain, verifySsoDomain } from "@/lib/services/sso";
import { signInWithPassword } from "@/lib/services/auth";
import { resolveSessionForTest } from "@/lib/services/context";
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

let token = "";

function scim(method: string, path: string, body?: unknown, query = "", auth = token) {
  const request: ScimRequest = { method, path, query: new URLSearchParams(query), authorization: auth ? `Bearer ${auth}` : null, body };
  return handleScim(request) as { status: number; body: Record<string, unknown> };
}

beforeEach(async () => {
  resetMemoryStore(new Date("2026-09-26T15:00:00.000Z"));
  const admin = contextFor("admin@northstar.demo");
  const { txtValue } = addSsoDomain(admin, "northstar.demo");
  await verifySsoDomain(admin, "northstar.demo", async () => [[txtValue]]);
  token = rotateScimToken(admin);
});

describe("SCIM authentication and isolation", () => {
  it("requires a valid token and only shows the token owner's people", () => {
    expect(scim("GET", "/Users", undefined, "", "").status).toBe(401);
    expect(scim("GET", "/Users", undefined, "", "hfscim_wrong").status).toBe(401);
    const list = scim("GET", "/Users");
    expect(list.status).toBe(200);
    const names = (list.body.Resources as { userName: string }[]).map((item) => item.userName);
    expect(names).toContain("specialist@northstar.demo");
    expect(names.some((name) => name.endsWith("@lakeside.demo"))).toBe(false);
    const lakeside = readDb().users.find((item) => item.email === "rival@lakeside.demo")!;
    expect(scim("GET", `/Users/${lakeside.id}`).status).toBe(404);
    expect(readDb().organizations.find((org) => org.scim)?.scim?.tokenHash).not.toContain(token);
  });

  it("stops working when the token is revoked or replaced", () => {
    const admin = contextFor("admin@northstar.demo");
    const next = rotateScimToken(admin);
    expect(scim("GET", "/Users").status).toBe(401);
    expect(scim("GET", "/Users", undefined, "", next).status).toBe(200);
    revokeScimToken(admin);
    expect(scim("GET", "/Users", undefined, "", next).status).toBe(401);
  });
});

describe("SCIM user lifecycle (Entra-style requests)", () => {
  it("creates, finds by filter, deactivates with a string 'False', and reactivates", () => {
    const created = scim("POST", "/Users", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "Nia.Brooks@northstar.demo",
      externalId: "entra-123",
      name: { givenName: "Nia", familyName: "Brooks" },
      active: true,
    });
    expect(created.status).toBe(201);
    const id = String(created.body.id);
    expect(scim("POST", "/Users", { userName: "nia.brooks@northstar.demo" }).status).toBe(409);

    const found = scim("GET", "/Users", undefined, 'filter=userName eq "nia.brooks@northstar.demo"');
    expect(found.body.totalResults).toBe(1);
    expect(scim("GET", "/Users", undefined, 'filter=externalId eq "entra-123"').body.totalResults).toBe(1);
    expect(scim("GET", "/Users", undefined, 'filter=displayName co "Nia"').status).toBe(400);

    const off = scim("PATCH", `/Users/${id}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Replace", path: "active", value: "False" }],
    });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect(readDb().organizationMembers.find((item) => item.userId === id)?.status).toBe("SUSPENDED");

    const on = scim("PATCH", `/Users/${id}`, { Operations: [{ op: "replace", value: { active: true, displayName: "Nia R. Brooks" } }] });
    expect(on.body.active).toBe(true);
    expect(readDb().profiles.find((item) => item.id === id)?.fullName).toBe("Nia R. Brooks");
    expect(readDb().auditEvents.filter((event) => event.event.startsWith("scim.user_")).length).toBeGreaterThanOrEqual(4);
  });

  it("ends an existing person's sessions the moment they are disabled", () => {
    const signedIn = signInWithPassword("specialist@northstar.demo", DEMO_PASSWORD);
    if (signedIn.kind !== "session") throw new Error("expected session");
    expect(resolveSessionForTest(signedIn.session)).not.toBeNull();
    const id = signedIn.session.sub;
    expect(scim("DELETE", `/Users/${id}`).status).toBe(204);
    expect(resolveSessionForTest(signedIn.session)).toBeNull();
    expect(() => signInWithPassword("specialist@northstar.demo", DEMO_PASSWORD)).toThrow();
    expect(readDb().users.some((item) => item.id === id)).toBe(true);
  });

  it("refuses unverified domains and never deactivates an owner", () => {
    expect(scim("POST", "/Users", { userName: "someone@gmail.com" }).status).toBe(400);
    const owner = readDb().users.find((item) => item.email === "owner@northstar.demo")!;
    const result = scim("PATCH", `/Users/${owner.id}`, { Operations: [{ op: "replace", path: "active", value: false }] });
    expect(result.status).toBe(400);
    expect(readDb().organizationMembers.find((item) => item.userId === owner.id && item.role === "OWNER")?.status).toBe("ACTIVE");
  });

  it("answers the discovery endpoints", () => {
    expect(scim("GET", "/ServiceProviderConfig").body.patch).toEqual({ supported: true });
    expect(scim("GET", "/Groups").status).toBe(404);
  });
});
