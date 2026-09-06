// Signed CSRF tokens (double-submit cookie + header). Edge-compatible.

import {
  fromBase64Url,
  hmacSign,
  hmacVerify,
  randomBase64Url,
  resolveSecret,
  toBase64Url,
  utf8Decode,
  utf8Encode
} from "@/lib/signing";

export const CSRF_COOKIE_NAME = "inzet_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_FIELD_NAME = "_csrf";
export const CSRF_TOKEN_TTL_SECONDS = 60 * 30;

const SIGNING_PURPOSE = "inzet-csrf";

type CsrfPayload = {
  e: number;
  n: string;
  s: string;
};

function getCsrfSecret(): string {
  return resolveSecret("CSRF_SECRET", "SESSION_SECRET");
}

function parsePayload(payloadPart: string): { payload: CsrfPayload; payloadBytes: Uint8Array } | null {
  try {
    const payloadBytes = fromBase64Url(payloadPart);
    const parsed = JSON.parse(utf8Decode(payloadBytes)) as Partial<CsrfPayload>;
    if (
      !parsed ||
      typeof parsed.s !== "string" ||
      typeof parsed.e !== "number" ||
      typeof parsed.n !== "string"
    ) {
      return null;
    }
    return {
      payload: {
        s: parsed.s,
        e: parsed.e,
        n: parsed.n
      },
      payloadBytes
    };
  } catch {
    return null;
  }
}

export function resolveCsrfScope(sessionAlias?: string | null) {
  const normalized = sessionAlias?.trim();
  if (!normalized) {
    return "anon";
  }
  return `alias:${normalized}`;
}

export async function issueCsrfToken(scope: string, nowMs = Date.now()) {
  const nowSeconds = Math.floor(nowMs / 1000);
  const payload: CsrfPayload = {
    s: scope,
    e: nowSeconds + CSRF_TOKEN_TTL_SECONDS,
    n: randomBase64Url(18)
  };
  const payloadBytes = utf8Encode(JSON.stringify(payload));
  const signature = await hmacSign(getCsrfSecret(), SIGNING_PURPOSE, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(signature)}`;
}

export async function verifyCsrfToken(token: string, expectedScope: string, nowMs = Date.now()) {
  const [payloadPart, signaturePart, ...rest] = token.split(".");
  if (!payloadPart || !signaturePart || rest.length > 0) {
    return false;
  }

  const parsed = parsePayload(payloadPart);
  if (!parsed) {
    return false;
  }

  if (parsed.payload.s !== expectedScope) {
    return false;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (parsed.payload.e < nowSeconds) {
    return false;
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64Url(signaturePart);
  } catch {
    return false;
  }

  return hmacVerify(getCsrfSecret(), SIGNING_PURPOSE, signatureBytes, parsed.payloadBytes);
}
