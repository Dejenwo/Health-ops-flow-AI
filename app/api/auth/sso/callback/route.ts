import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SSO_COOKIE, sessionCookieOptions, signSession, verifySsoState } from "@/lib/auth/session-token";
import { completeSso } from "@/lib/services/sso";
import { AppError } from "@/lib/domain/errors";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = verifySsoState(request.cookies.get(SSO_COOKIE)?.value);
  const target = request.nextUrl.clone();
  target.search = "";
  try {
    const { session, next } = await completeSso(state, { code: params.get("code"), state: params.get("state"), error: params.get("error") });
    target.pathname = next;
    const response = NextResponse.redirect(target, 302);
    response.cookies.set(SESSION_COOKIE, signSession(session), sessionCookieOptions(session));
    response.cookies.delete({ name: SSO_COOKIE, path: "/api/auth/sso" });
    return response;
  } catch (error) {
    target.pathname = "/login";
    target.searchParams.set("sso_error", error instanceof AppError ? error.message : "Sign-in could not be completed.");
    const response = NextResponse.redirect(target, 302);
    response.cookies.delete({ name: SSO_COOKIE, path: "/api/auth/sso" });
    return response;
  }
}
