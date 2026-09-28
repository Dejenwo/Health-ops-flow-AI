import { NextResponse, type NextRequest } from "next/server";
import { cookieSecure, SSO_COOKIE, signSsoState } from "@/lib/auth/session-token";
import { SSO_STATE_MS, startSso } from "@/lib/services/sso";
import { AppError } from "@/lib/domain/errors";

/**
 * GET so the browser navigates to the identity provider directly. A form POST that redirects
 * off-site would be blocked by the `form-action 'self'` Content Security Policy.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email") ?? "";
  const next = request.nextUrl.searchParams.get("next") ?? "";
  const back = request.nextUrl.clone();
  back.pathname = "/login";
  back.search = "";
  try {
    const { url, state } = await startSso(email, next);
    const response = NextResponse.redirect(url, 302);
    response.cookies.set(SSO_COOKIE, signSsoState(state), {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
      path: "/api/auth/sso",
      maxAge: Math.floor(SSO_STATE_MS / 1000),
    });
    return response;
  } catch (error) {
    back.searchParams.set("sso_error", error instanceof AppError ? error.message : "Single sign-on is unavailable right now.");
    return NextResponse.redirect(back, 302);
  }
}
