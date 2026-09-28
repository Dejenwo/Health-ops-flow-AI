import { cookies } from "next/headers";
import {
  cookieSecure,
  MFA_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signMfaChallenge,
  signSession,
  type MfaChallengePayload,
  type SessionPayload,
} from "@/lib/auth/session-token";

export async function writeSession(payload: SessionPayload): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(payload), sessionCookieOptions(payload));
  jar.delete(MFA_COOKIE);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(MFA_COOKIE);
}

export async function writeMfaChallenge(payload: MfaChallengePayload): Promise<void> {
  const jar = await cookies();
  jar.set(MFA_COOKIE, signMfaChallenge(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: Math.max(0, Math.floor((payload.exp - Date.now()) / 1000)),
  });
}

export async function readMfaChallengeToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(MFA_COOKIE)?.value;
}
