// Web Crypto helpers shared by session and CSRF tokens.
// Must stay edge-compatible: middleware.ts runs on the edge runtime.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();
const warnedSecrets = new Set<string>();

export const MIN_SECRET_LENGTH = 32;

type SecretEnvName = "SESSION_SECRET" | "CSRF_SECRET";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolve a signing secret from the environment.
 *
 * Production: the secret is mandatory and must be at least MIN_SECRET_LENGTH characters,
 * otherwise we fail closed. Development: fall back to a fixed dev-only value and warn once.
 */
export function resolveSecret(envName: SecretEnvName, fallbackEnvName?: SecretEnvName): string {
  const configured =
    process.env[envName]?.trim() || (fallbackEnvName ? process.env[fallbackEnvName]?.trim() : "");
  if (configured && configured.length >= MIN_SECRET_LENGTH) {
    return configured;
  }

  if (isProduction()) {
    throw new Error(
      `${envName} ontbreekt of is korter dan ${MIN_SECRET_LENGTH} tekens. Genereer er een met: openssl rand -hex 32`
    );
  }

  if (!warnedSecrets.has(envName)) {
    warnedSecrets.add(envName);
    console.warn(
      `[inzet] ${envName} niet gezet; development-fallback in gebruik. Zet ${envName} in .env (openssl rand -hex 32).`
    );
  }
  return `inzet-dev-${envName.toLowerCase()}-fallback-not-for-production`;
}

export function utf8Encode(value: string): Uint8Array {
  return encoder.encode(value);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Throws on malformed input. */
export function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url input");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const binary = atob(normalized + "=".repeat(padLength));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function randomBase64Url(size = 16): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function getHmacKey(secret: string, purpose: string): Promise<CryptoKey> {
  const cacheKey = `${purpose} ${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    // Purpose-specific key material so a token of one kind can never be replayed as another.
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(`${purpose}:${secret}`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    keyCache.set(cacheKey, key);
  }
  return key;
}

export async function hmacSign(secret: string, purpose: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await getHmacKey(secret, purpose);
  const signature = await crypto.subtle.sign("HMAC", key, toBufferSource(data));
  return new Uint8Array(signature);
}

export async function hmacVerify(
  secret: string,
  purpose: string,
  signature: Uint8Array,
  data: Uint8Array
): Promise<boolean> {
  const key = await getHmacKey(secret, purpose);
  return crypto.subtle.verify("HMAC", key, toBufferSource(signature), toBufferSource(data));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toBufferSource(encoder.encode(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
