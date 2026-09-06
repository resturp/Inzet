import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const preload = new URL("../scripts/database-env.mjs", import.meta.url).pathname;

function readDatabaseUrl(overrides: Record<string, string | undefined>) {
  const env = { ...process.env };
  for (const key of ["NODE_OPTIONS", "POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
    delete env[key];
  }
  return spawnSync(process.execPath, ["--import", preload, "-e", "process.stdout.write(process.env.DATABASE_URL || '')"], {
    env: { ...env, ...overrides },
    encoding: "utf8"
  });
}

test("Docker credentials override stale URLs and preserve special characters", () => {
  const user = 'Db "Admin"';
  const password = "p@ss:/?#%$'\\ word";
  const database = "inzet / test";
  const result = readDatabaseUrl({
    POSTGRES_HOST: "db", POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database,
    DATABASE_URL: "postgresql://wrong:old@localhost/wrong",
    DOCKER_DATABASE_URL: "postgresql://wrong:old@db/wrong"
  });
  assert.equal(result.status, 0, result.stderr);
  const url = new URL(result.stdout);
  assert.equal(url.hostname, "db");
  assert.equal(decodeURIComponent(url.username), user);
  assert.equal(decodeURIComponent(url.password), password);
  assert.equal(decodeURIComponent(url.pathname.slice(1)), database);
  assert.equal(url.searchParams.get("schema"), "public");
});

test("outside Docker the local DATABASE_URL is preserved", () => {
  const url = "postgresql://local:password@localhost/local";
  const result = readDatabaseUrl({ DATABASE_URL: url });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, url);
});

test("incomplete Docker configuration fails before starting the application", () => {
  const result = readDatabaseUrl({ POSTGRES_HOST: "db", POSTGRES_USER: "postgres", POSTGRES_DB: "inzet" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /POSTGRES_PASSWORD must be set/);
  assert.equal(result.stdout, "");
});
