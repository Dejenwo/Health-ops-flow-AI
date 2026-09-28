import { createHmac, timingSafeEqual } from "crypto";
import type { Role } from "@/lib/domain/types";

export const SESSION_COOKIE = "hf_session";
export const MFA_COOKIE = "hf_mfa";

export interface SessionPayload {
  sub: string;
  org: string;
  /** Informational only. Services always reload the role from membership records. */
  role: Role;
  onboarded: boolean;
  /** Must equal the user's current sessionVersion or the session is rejected. */
  sv: number;
  /** Issued at (ms). */
  iat: number;
  /** Absolute expiry (ms). */
  exp: number;
  /** Last activity (ms), refreshed by the proxy. */
  last: number;
  /** Inactivity limit in minutes (HIPAA §164.312(a)(2)(iii) automatic logoff). */
  idle: number;
  /** The organization requires MFA and this user has not enrolled yet. */
  mfaEnroll: boolean;
  /** How the user authenticated: password (+ MFA) or single sign-on. */
  amr?: "pwd" | "sso";
}

export const SSO_COOKIE = "hf_sso";

/** Short-lived state for one SSO round trip: CSRF state, replay nonce and PKCE verifier. */
export interface SsoStatePayload {
  purpose: "sso";
  org: string;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  exp: number;
}

export interface MfaChallengePayload {
  sub: string;
  org: string;
  exp: number;
  purpose: "mfa";
}

const DEV_SECRET = "healthflow-demo-session-secret-not-for-production";

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || DEV_SECRET;
}

export function isDemoSessionSecret(): boolean {
  return !process.env.SESSION_SECRET;
}

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token: string | undefined | null): unknown {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function signSession(payload: SessionPayload): string {
  return sign(payload);
}

export type SessionCheck =
  | { ok: true; session: SessionPayload }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "idle" };

export function checkSession(token: string | undefined | null, now = Date.now()): SessionCheck {
  if (!token) return { ok: false, reason: "missing" };
  const payload = verify(token) as SessionPayload | null;
  if (!payload || !payload.sub || !payload.org || !payload.exp || typeof payload.sv !== "number" || !payload.last || !payload.idle) {
    return { ok: false, reason: "invalid" };
  }
  if (payload.exp < now) return { ok: false, reason: "expired" };
  if (now - payload.last > payload.idle * 60_000) return { ok: false, reason: "idle" };
  return { ok: true, session: payload };
}

export function verifySession(token: string | undefined | null, now = Date.now()): SessionPayload | null {
  const result = checkSession(token, now);
  return result.ok ? result.session : null;
}

export function signMfaChallenge(payload: MfaChallengePayload): string {
  return sign(payload);
}

export function verifyMfaChallenge(token: string | undefined | null, now = Date.now()): MfaChallengePayload | null {
  const payload = verify(token) as MfaChallengePayload | null;
  if (!payload || payload.purpose !== "mfa" || !payload.sub || !payload.org || payload.exp < now) return null;
  return payload;
}

export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

export function sessionCookieOptions(payload: SessionPayload) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge: Math.max(0, Math.floor((payload.exp - Date.now()) / 1000)),
  };
}

export function signSsoState(payload: SsoStatePayload): string {
  return sign(payload);
}

export function verifySsoState(token: string | undefined | null, now = Date.now()): SsoStatePayload | null {
  const payload = verify(token) as SsoStatePayload | null;
  if (!payload || payload.purpose !== "sso" || !payload.state || !payload.nonce || !payload.verifier || payload.exp < now) return null;
  return payload;
}
