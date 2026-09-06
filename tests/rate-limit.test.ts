import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeRateLimit,
  enforceRateLimits,
  getClientIp,
  resetRateLimits
} from "../src/lib/rate-limit";

test("rate limit blocks after the configured number of hits and recovers after the window", () => {
  resetRateLimits();
  const rule = { limit: 3, windowMs: 10_000 };
  const start = 1_000_000;

  assert.equal(consumeRateLimit("k", rule, start).allowed, true);
  assert.equal(consumeRateLimit("k", rule, start + 1).allowed, true);
  assert.equal(consumeRateLimit("k", rule, start + 2).allowed, true);

  const blocked = consumeRateLimit("k", rule, start + 3);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 10);

  assert.equal(consumeRateLimit("other", rule, start + 3).allowed, true, "keys are independent");
  assert.equal(consumeRateLimit("k", rule, start + 10_001).allowed, true, "window has slid");
});

test("enforceRateLimits returns a 429 response with Retry-After", async () => {
  resetRateLimits();
  const rule = { limit: 1, windowMs: 60_000 };
  assert.equal(enforceRateLimits([{ key: "x", rule }], 5_000), null);

  const response = enforceRateLimits([{ key: "x", rule }], 6_000);
  assert.ok(response);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "59");
  assert.match((await response.json()).error, /Te veel pogingen/);
});

test("client ip prefers the first X-Forwarded-For hop", () => {
  const forwarded = new Request("http://localhost/api/x", {
    headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" }
  });
  assert.equal(getClientIp(forwarded), "203.0.113.5");

  const realIp = new Request("http://localhost/api/x", { headers: { "x-real-ip": "198.51.100.7" } });
  assert.equal(getClientIp(realIp), "198.51.100.7");

  assert.equal(getClientIp(new Request("http://localhost/api/x")), "unknown");
});
