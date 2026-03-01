import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_TOKEN_TTL_SECONDS,
  issueCsrfToken,
  resolveCsrfScope,
  verifyCsrfToken
} from "@/lib/csrf";
import { SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET() {
  const cookieStore = await cookies();
  const sessionAlias = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  const scope = resolveCsrfScope(sessionAlias);

  const existingToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? "";
  const token =
    existingToken && (await verifyCsrfToken(existingToken, scope))
      ? existingToken
      : await issueCsrfToken(scope);

  const response = NextResponse.json({ token }, { status: 200 });
  response.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CSRF_TOKEN_TTL_SECONDS,
    path: "/"
  });

  return response;
}
