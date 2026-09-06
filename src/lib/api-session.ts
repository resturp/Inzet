import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { flushDueNotificationDigests } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  passwordFingerprint,
  sessionCookieOptions,
  verifySessionToken,
  type VerifiedSession
} from "@/lib/session";

/** The signed session from the request cookie, or null when absent, tampered or expired. */
export async function getVerifiedSession(): Promise<VerifiedSession | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export async function getSessionAlias(): Promise<string | null> {
  const session = await getVerifiedSession();
  return session?.alias ?? null;
}

export async function getSessionUser() {
  const session = await getVerifiedSession();
  if (!session) {
    return null;
  }
  const user = await prisma.user.findUnique({ where: { alias: session.alias } });
  if (!user || !user.isActive) {
    return null;
  }
  // Sessions are bound to the password at login time: changing the password logs out every
  // other session for this user.
  if ((await passwordFingerprint(user.passwordHash)) !== session.passwordFingerprint) {
    return null;
  }
  void flushDueNotificationDigests({ userAliases: [user.alias] }).catch((error) => {
    console.error("Failed to flush due notification digests", { alias: user.alias, error });
  });
  return user;
}

export async function attachSessionCookie(
  response: NextResponse,
  user: { alias: string; passwordHash: string | null | undefined }
): Promise<NextResponse> {
  const token = await createSessionToken(user);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...sessionCookieOptions()
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(0)
  });
  return response;
}
