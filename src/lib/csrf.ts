const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const CSRF_COOKIE_NAME = "inzet_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_FIELD_NAME = "_csrf";
export const CSRF_TOKEN_TTL_SECONDS = 60 * 30;

type CsrfPayload = {
  e: number;
  n: string;
  s: string;
};

let keyPromise: Promise<CryptoKey> | null = null;

function getCsrfSecret() {
  const envSecret = process.env.CSRF_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (envSecret) {
    return envSecret;
  }

  return "inzet-dev-csrf-secret-change-me";
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomNonce(size = 16) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function toBufferSource(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

async function getSigningKey() {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(getCsrfSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return keyPromise;
}

function serializePayload(payload: CsrfPayload) {
  return encoder.encode(JSON.stringify(payload));
}

function parsePayload(payloadPart: string): { payload: CsrfPayload; payloadBytes: Uint8Array } | null {
  try {
    const payloadBytes = fromBase64Url(payloadPart);
    const payloadText = decoder.decode(payloadBytes);
    const parsed = JSON.parse(payloadText) as Partial<CsrfPayload>;
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
    n: randomNonce(18)
  };
  const payloadBytes = serializePayload(payload);
  const signingKey = await getSigningKey();
  const signature = await crypto.subtle.sign("HMAC", signingKey, toBufferSource(payloadBytes));
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyCsrfToken(token: string, expectedScope: string, nowMs = Date.now()) {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) {
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

  const signingKey = await getSigningKey();
  return crypto.subtle.verify(
    "HMAC",
    signingKey,
    toBufferSource(signatureBytes),
    toBufferSource(parsed.payloadBytes)
  );
}
