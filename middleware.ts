import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login-password",
  "/api/auth/request-magic-link",
  "/api/auth/verify-magic-link",
  "/api/auth/logout",
  "/api/health"
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (PUBLIC_API_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const sessionAlias = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (!sessionAlias) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"]
};
