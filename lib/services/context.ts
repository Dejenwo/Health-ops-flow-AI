import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/auth/session-token";
import type { RequestContext } from "@/lib/domain/types";
import { readDb } from "@/lib/store";

/**
 * Resolves the caller from the signed cookie, then re-checks everything that can change after
 * the cookie was issued: the account exists, its session version still matches (password change,
 * MFA change and "sign out everywhere" all bump it), and the membership is still active.
 * The role always comes from the membership record, never from the cookie.
 */
function resolve(session: SessionPayload | null): RequestContext | null {
  if (!session) return null;
  const db = readDb();
  const user = db.users.find((item) => item.id === session.sub);
  if (!user || user.sessionVersion !== session.sv) return null;
  const profile = db.profiles.find((item) => item.id === session.sub);
  const membership = db.organizationMembers.find(
    (item) => item.userId === session.sub && item.organizationId === session.org && item.status === "ACTIVE",
  );
  const organization = db.organizations.find((item) => item.id === session.org);
  if (!profile || !membership || !organization) return null;
  // Organizations that require SSO accept only SSO sessions, except an owner's break-glass password session.
  if (organization.sso?.enabled && organization.sso.requireSso && session.amr !== "sso" && membership.role !== "OWNER") return null;
  return {
    userId: user.id,
    email: user.email,
    role: membership.role,
    organizationId: organization.id,
    profile,
    organization,
  };
}

export async function getRequestContext(): Promise<RequestContext> {
  const jar = await cookies();
  const ctx = resolve(verifySession(jar.get(SESSION_COOKIE)?.value));
  if (!ctx) redirect("/login?reason=signed-out");
  return ctx;
}

export async function getOptionalContext(): Promise<RequestContext | null> {
  const jar = await cookies();
  return resolve(verifySession(jar.get(SESSION_COOKIE)?.value));
}

export { resolve as resolveSessionForTest };
