// Small in-memory rate limiter for the authentication endpoints.
// The app runs as a single Node process behind a reverse proxy, so process-local state is enough.

import { NextResponse } from "next/server";

export type RateLimitRule = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  hits: number[];
  windowMs: number;
};

const MINUTE_MS = 60_000;

export const RATE_LIMITS = {
  loginPerIp: { limit: 30, windowMs: 15 * MINUTE_MS },
  loginPerIdentifier: { limit: 10, windowMs: 15 * MINUTE_MS },
  magicLinkPerIp: { limit: 10, windowMs: 60 * MINUTE_MS },
  magicLinkPerTarget: { limit: 5, windowMs: 60 * MINUTE_MS },
  tokenPerIp: { limit: 30, windowMs: 15 * MINUTE_MS }
} as const satisfies Record<string, RateLimitRule>;

const buckets = new Map<string, Bucket>();
let lastSweepMs = 0;

function sweep(nowMs: number) {
  if (nowMs - lastSweepMs < MINUTE_MS) {
    return;
  }
  lastSweepMs = nowMs;
  for (const [key, bucket] of buckets) {
    const windowStart = nowMs - bucket.windowMs;
    bucket.hits = bucket.hits.filter((timestamp) => timestamp > windowStart);
    if (bucket.hits.length === 0) {
      buckets.delete(key);
    }
  }
}

export function consumeRateLimit(key: string, rule: RateLimitRule, nowMs = Date.now()): RateLimitResult {
  sweep(nowMs);
  const windowStart = nowMs - rule.windowMs;
  const existing = buckets.get(key);
  const hits = (existing?.hits ?? []).filter((timestamp) => timestamp > windowStart);

  if (hits.length >= rule.limit) {
    buckets.set(key, { hits, windowMs: rule.windowMs });
    const oldest = hits[0] ?? nowMs;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - nowMs) / 1000))
    };
  }

  hits.push(nowMs);
  buckets.set(key, { hits, windowMs: rule.windowMs });
  return { allowed: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
  lastSweepMs = 0;
}

/** Best-effort client address. Behind the reverse proxy this is the first X-Forwarded-For hop. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Te veel pogingen. Probeer het over een paar minuten opnieuw." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/** Consume every check; return a 429 response for the first one that is exhausted. */
export function enforceRateLimits(
  checks: Array<{ key: string; rule: RateLimitRule }>,
  nowMs = Date.now()
): NextResponse | null {
  for (const check of checks) {
    const result = consumeRateLimit(check.key, check.rule, nowMs);
    if (!result.allowed) {
      return rateLimitedResponse(result.retryAfterSeconds);
    }
  }
  return null;
}
