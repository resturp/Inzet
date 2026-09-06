// Next.js only picks up middleware from src/ when the project uses a src/ directory.
// This file used to live at the repository root and was therefore never bundled.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_TTL_SECONDS,
  issueCsrfToken,
  resolveCsrfScope,
  verifyCsrfToken
} from "@/lib/csrf";
import { SESSION_COOKIE_NAME, sessionCookieOptions, verifySessionToken } from "@/lib/session";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

const PUBLIC_API_PATHS = new Set([
  "/api/csrf",
  "/api/auth/login-password",
  "/api/auth/complete-login-name",
  "/api/auth/complete-registration",
  "/api/auth/registration-options",
  "/api/auth/request-email-verification",
  "/api/auth/request-magic-link",
  "/api/auth/verify-magic-link",
  "/api/auth/logout",
  "/api/health"
]);

function setCsrfCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CSRF_TOKEN_TTL_SECONDS,
    path: "/"
  });
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set({ name: SESSION_COOKIE_NAME, value: "", ...sessionCookieOptions(0) });
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hosts an Origin header may carry. Behind the reverse proxy `request.nextUrl` can be
 * http://127.0.0.1:3000, so compare hosts against the forwarded/Host header and the
 * configured public URL instead of against nextUrl.
 */
function allowedOriginHosts(request: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = request.headers.get("host")?.trim();
  for (const candidate of [forwardedHost, hostHeader, request.nextUrl.host]) {
    if (candidate) {
      hosts.add(candidate.toLowerCase());
    }
  }
  const publicHost = hostOf(process.env.NEXT_PUBLIC_APP_URL);
  if (publicHost) {
    hosts.add(publicHost);
  }
  return hosts;
}

function rejectCrossSiteRequest(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (origin) {
    const originHost = hostOf(origin);
    if (!originHost || !allowedOriginHosts(request).has(originHost)) {
      return NextResponse.json({ error: "Cross-origin request geblokkeerd" }, { status: 403 });
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return NextResponse.json({ error: "Cross-site request geblokkeerd" }, { status: 403 });
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only a correctly signed, unexpired token counts as a session. Anything else is anonymous.
  const rawSessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim() ?? "";
  const session = rawSessionCookie ? await verifySessionToken(rawSessionCookie) : null;
  const sessionAlias = session?.alias ?? "";
  const hasStaleSessionCookie = rawSessionCookie.length > 0 && !session;

  const csrfScope = resolveCsrfScope(sessionAlias || null);
  const csrfCookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value?.trim() ?? "";
  const hasValidCsrfCookie = csrfCookieToken
    ? await verifyCsrfToken(csrfCookieToken, csrfScope)
    : false;

  async function passThrough(): Promise<NextResponse> {
    const response = NextResponse.next();
    if (hasStaleSessionCookie) {
      clearSessionCookie(response);
    }
    if (!hasValidCsrfCookie) {
      setCsrfCookie(response, await issueCsrfToken(csrfScope));
    }
    return response;
  }

  if (pathname.startsWith("/_next/") && /\.[a-z0-9]+\/$/i.test(pathname)) {
    return new NextResponse("Niet gevonden", { status: 404 });
  }

  if (!pathname.startsWith("/api/")) {
    return passThrough();
  }

  if (!SAFE_HTTP_METHODS.has(request.method.toUpperCase())) {
    const rejected = rejectCrossSiteRequest(request);
    if (rejected) {
      return rejected;
    }

    const csrfHeaderToken = request.headers.get(CSRF_HEADER_NAME)?.trim() ?? "";
    if (!csrfHeaderToken || !csrfCookieToken || csrfHeaderToken !== csrfCookieToken) {
      return NextResponse.json({ error: "CSRF-validatie mislukt" }, { status: 403 });
    }

    if (!(await verifyCsrfToken(csrfHeaderToken, csrfScope))) {
      return NextResponse.json({ error: "CSRF-token ongeldig of verlopen" }, { status: 403 });
    }
  }

  if (PUBLIC_API_PATHS.has(pathname)) {
    return passThrough();
  }

  if (!sessionAlias) {
    const response = NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    if (hasStaleSessionCookie) {
      clearSessionCookie(response);
    }
    return response;
  }

  return passThrough();
}

export const config = {
  matcher: ["/api/:path*", "/_next/:path*"]
};
