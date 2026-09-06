import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_TTL_SECONDS,
  createSessionToken,
  passwordFingerprint,
  verifySessionToken
} from "../src/lib/session";

const TEST_SECRET = "test-session-secret-0123456789abcdef0123456789";

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("session token round-trips alias and password fingerprint", async () => {
  await withEnv({ SESSION_SECRET: TEST_SECRET, NODE_ENV: "test" }, async () => {
    const token = await createSessionToken({ alias: "jan", passwordHash: "scrypt$1$2$3$salt$hash" });
    const session = await verifySessionToken(token);
    assert.ok(session);
    assert.equal(session.alias, "jan");
    assert.equal(session.passwordFingerprint, await passwordFingerprint("scrypt$1$2$3$salt$hash"));
    assert.equal(session.expiresAt - session.issuedAt, SESSION_TTL_SECONDS);
  });
});

test("a bare alias (the old cookie format) is not a session", async () => {
  await withEnv({ SESSION_SECRET: TEST_SECRET, NODE_ENV: "test" }, async () => {
    assert.equal(await verifySessionToken("Bestuur"), null);
    assert.equal(await verifySessionToken(""), null);
    assert.equal(await verifySessionToken(undefined), null);
    assert.equal(await verifySessionToken("v1.abc"), null);
  });
});

test("tampering with the payload or signature is rejected", async () => {
  await withEnv({ SESSION_SECRET: TEST_SECRET, NODE_ENV: "test" }, async () => {
    const token = await createSessionToken({ alias: "jan", passwordHash: null });
    const [version, payload, signature] = token.split(".");

    const forgedPayload = Buffer.from(JSON.stringify({ a: "Bestuur", i: 1, e: 2 ** 31, p: "" }))
      .toString("base64url");
    assert.equal(await verifySessionToken(`${version}.${forgedPayload}.${signature}`), null);

    const flipped = signature.endsWith("A") ? `${signature.slice(0, -1)}B` : `${signature.slice(0, -1)}A`;
    assert.equal(await verifySessionToken(`${version}.${payload}.${flipped}`), null);

    assert.equal(await verifySessionToken(`${version}.${payload}.${signature}.extra`), null);
  });
});

test("expired tokens and tokens signed with another secret are rejected", async () => {
  await withEnv({ SESSION_SECRET: TEST_SECRET, NODE_ENV: "test" }, async () => {
    const issuedAt = Date.now();
    const token = await createSessionToken({ alias: "jan", passwordHash: null }, issuedAt);
    assert.ok(await verifySessionToken(token, issuedAt + (SESSION_TTL_SECONDS - 1) * 1000));
    assert.equal(await verifySessionToken(token, issuedAt + (SESSION_TTL_SECONDS + 1) * 1000), null);

    await withEnv({ SESSION_SECRET: "another-secret-that-is-also-long-enough-123456" }, async () => {
      assert.equal(await verifySessionToken(token), null);
    });
  });
});

test("password fingerprint changes when the password hash changes", async () => {
  const before = await passwordFingerprint("hash-a");
  const after = await passwordFingerprint("hash-b");
  assert.notEqual(before, after);
  assert.equal(before.length, 16);
  assert.equal(await passwordFingerprint(null), await passwordFingerprint(undefined));
});

test("production refuses to run without a strong SESSION_SECRET", async () => {
  await withEnv({ NODE_ENV: "production", SESSION_SECRET: undefined, CSRF_SECRET: undefined }, async () => {
    await assert.rejects(() => createSessionToken({ alias: "jan", passwordHash: null }), /SESSION_SECRET/);
  });
  await withEnv({ NODE_ENV: "production", SESSION_SECRET: "too-short" }, async () => {
    await assert.rejects(() => createSessionToken({ alias: "jan", passwordHash: null }), /SESSION_SECRET/);
  });
});
