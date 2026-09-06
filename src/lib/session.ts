// Signed, stateless session tokens. Edge-compatible (used by middleware.ts).
//
// The previous implementation stored the bare alias in the cookie, which meant anyone could
// impersonate any user by sending `Cookie: inzet_alias=<alias>`. Tokens are now HMAC-signed
// with SESSION_SECRET, carry an expiry, and are bound to the user's password hash so that a
// password change (or rotating SESSION_SECRET) invalidates existing sessions.

import {
  fromBase64Url,
  hmacSign,
  hmacVerify,
  resolveSecret,
  sha256Hex,
  toBase64Url,
  utf8Decode,
  utf8Encode
} from "@/lib/signing";

export const SESSION_COOKIE_NAME = "inzet_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const TOKEN_VERSION = "v1";
const SIGNING_PURPOSE = "inzet-session";
const CLOCK_SKEW_SECONDS = 60;

type SessionPayload = {
  a: string; // alias
  i: number; // issued at (unix seconds)
  e: number; // expires at (unix seconds)
  p: string; // password fingerprint
};

export type VerifiedSession = {
  alias: string;
  issuedAt: number;
  expiresAt: number;
  passwordFingerprint: string;
};

export function getSessionSecret(): string {
  return resolveSecret("SESSION_SECRET");
}

export async function passwordFingerprint(passwordHash: string | null | undefined): Promise<string> {
  return (await sha256Hex(passwordHash ?? "")).slice(0, 16);
}

export async function createSessionToken(
  input: { alias: string; passwordHash: string | null | undefined },
  nowMs = Date.now()
): Promise<string> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const payload: SessionPayload = {
    a: input.alias,
    i: nowSeconds,
    e: nowSeconds + SESSION_TTL_SECONDS,
    p: await passwordFingerprint(input.passwordHash)
  };
  const signedPart = `${TOKEN_VERSION}.${toBase64Url(utf8Encode(JSON.stringify(payload)))}`;
  const signature = await hmacSign(getSessionSecret(), SIGNING_PURPOSE, utf8Encode(signedPart));
  return `${signedPart}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(
  token: string | null | undefined,
  nowMs = Date.now()
): Promise<VerifiedSession | null> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return null;
  }
  const [version, payloadPart, signaturePart] = parts;

  let signature: Uint8Array;
  try {
    signature = fromBase64Url(signaturePart);
  } catch {
    return null;
  }

  const valid = await hmacVerify(
    getSessionSecret(),
    SIGNING_PURPOSE,
    signature,
    utf8Encode(`${version}.${payloadPart}`)
  );
  if (!valid) {
    return null;
  }

  let parsed: Partial<SessionPayload>;
  try {
    parsed = JSON.parse(utf8Decode(fromBase64Url(payloadPart))) as Partial<SessionPayload>;
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed.a !== "string" ||
    parsed.a.length === 0 ||
    typeof parsed.i !== "number" ||
    typeof parsed.e !== "number" ||
    typeof parsed.p !== "string"
  ) {
    return null;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (parsed.e <= nowSeconds) {
    return null;
  }
  if (parsed.i > nowSeconds + CLOCK_SKEW_SECONDS) {
    return null;
  }
  if (parsed.e - parsed.i > SESSION_TTL_SECONDS + CLOCK_SKEW_SECONDS) {
    return null;
  }

  return {
    alias: parsed.a,
    issuedAt: parsed.i,
    expiresAt: parsed.e,
    passwordFingerprint: parsed.p
  };
}

export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/"
  };
}
