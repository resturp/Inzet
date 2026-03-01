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
import { SESSION_COOKIE_NAME } from "@/lib/session";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

const PUBLIC_API_PATHS = new Set([
  "/api/csrf",
  "/api/auth/login-password",
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionAlias = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim() ?? "";
  const csrfScope = resolveCsrfScope(sessionAlias || null);
  const csrfCookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value?.trim() ?? "";
  const hasValidCsrfCookie = csrfCookieToken
    ? await verifyCsrfToken(csrfCookieToken, csrfScope)
    : false;

  if (pathname.startsWith("/_next/") && /\.[a-z0-9]+\/$/i.test(pathname)) {
    return new NextResponse("Niet gevonden", { status: 404 });
  }

  if (!pathname.startsWith("/api/")) {
    const response = NextResponse.next();
    if (!hasValidCsrfCookie) {
      setCsrfCookie(response, await issueCsrfToken(csrfScope));
    }
    return response;
  }

  if (!SAFE_HTTP_METHODS.has(request.method.toUpperCase())) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");

    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Cross-origin request geblokkeerd" }, { status: 403 });
    }

    if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
      return NextResponse.json({ error: "Cross-site request geblokkeerd" }, { status: 403 });
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
    const response = NextResponse.next();
    if (!hasValidCsrfCookie) {
      setCsrfCookie(response, await issueCsrfToken(csrfScope));
    }
    return response;
  }

  if (!sessionAlias) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const response = NextResponse.next();
  if (!hasValidCsrfCookie) {
    setCsrfCookie(response, await issueCsrfToken(csrfScope));
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/_next/:path*"]
};
