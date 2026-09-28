import { NextResponse, type NextRequest } from "next/server";
import { checkSession, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session-token";

const PUBLIC_EXACT = new Set([
  "/",
  "/product",
  "/security",
  "/pricing",
  "/contact",
  "/login",
  "/login/mfa",
  "/signup",
  "/forgot-password",
  "/reset-password",
]);

/** Paths a user who still has to enroll in MFA may reach. */
const ENROLL_ALLOWED = ["/settings/security", "/api/health"];

/** Refresh the rolling activity stamp at most once a minute to limit cookie churn. */
const ACTIVITY_REFRESH_MS = 60_000;

function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by charting and UI primitives. Style injection cannot run script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function secure(response: NextResponse, csp: string | null): NextResponse {
  if (csp) response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}

function redirectTo(request: NextRequest, pathname: string, params: Record<string, string> = {}, csp: string | null = null) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return secure(NextResponse.redirect(url), csp);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = isApi ? null : contentSecurityPolicy(nonce);
  const now = Date.now();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const check = checkSession(token, now);
  const session = check.ok ? check.session : null;
  const isPublic = PUBLIC_EXACT.has(pathname) || pathname.startsWith("/api/health") || pathname.startsWith("/api/auth/sso/") || pathname.startsWith("/api/scim/");

  if (!session) {
    if (!isPublic) {
      if (isApi) return secure(new NextResponse("Unauthorized", { status: 401 }), null);
      const params: Record<string, string> = {};
      if (pathname !== "/login") params.next = pathname;
      if (!check.ok && (check.reason === "idle" || check.reason === "expired")) params.reason = check.reason;
      const response = redirectTo(request, "/login", params, csp);
      if (token) response.cookies.delete(SESSION_COOKIE);
      return response;
    }
  } else {
    if (pathname === "/login" || pathname === "/signup") {
      return redirectTo(request, session.onboarded ? "/dashboard" : "/onboarding", {}, csp);
    }
    if (!session.onboarded && pathname !== "/onboarding" && !isApi && !isPublic) {
      return redirectTo(request, "/onboarding", {}, csp);
    }
    if (session.onboarded && pathname === "/onboarding") {
      return redirectTo(request, "/dashboard", {}, csp);
    }
    if (session.mfaEnroll && session.onboarded && !isPublic && !ENROLL_ALLOWED.some((path) => pathname.startsWith(path))) {
      return redirectTo(request, "/settings/security", { enroll: "1" }, csp);
    }
  }

  const requestHeaders = new Headers(request.headers);
  if (csp) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }
  const response = secure(NextResponse.next({ request: { headers: requestHeaders } }), csp);

  // Rolling inactivity window: any authenticated request counts as activity.
  if (session && now - session.last > ACTIVITY_REFRESH_MS) {
    const refreshed = { ...session, last: now };
    response.cookies.set(SESSION_COOKIE, signSession(refreshed), sessionCookieOptions(refreshed));
  }
  if (!isApi) response.headers.set("Cache-Control", session ? "private, no-store" : response.headers.get("Cache-Control") ?? "public, max-age=0");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
