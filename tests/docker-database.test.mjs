import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Explicit integration test: only this randomly named Compose project and its
// disposable volume are touched. Requires Docker Compose >= 2.24.4.
test("existing and fresh PostgreSQL volumes keep credentials and data consistent", { timeout: 180_000 }, () => {
  const root = new URL("../", import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), "inzet-db-test-"));
  const override = join(dir, "compose.yml");
  const project = `inzet-db-test-${process.pid}`;
  const env = {
    ...process.env,
    POSTGRES_USER: 'db_admin', POSTGRES_DB: "inzet test",
    POSTGRES_PASSWORD: "old-test-password",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789"
  };
  const args = ["compose", "-f", join(root, "docker-compose.yml"), "-f", join(root, "docker-compose.prod.yml"), "-f", override,
    "--env-file", "/dev/null", "--project-name", project];
  function compose(command, allowFailure = false) {
    const result = spawnSync("docker", [...args, ...command], { env, encoding: "utf8", timeout: 60_000 });
    if (!allowFailure) assert.equal(result.status, 0, result.stderr || result.stdout);
    return result;
  }
  function config() {
    writeFileSync(override, `services:
  db:
    restart: "no"
    healthcheck:
      interval: 1s
      retries: 10
`);
  }
  function query(sql, allowFailure = false, password = null) {
    const options = password === null ? [] : ["-e", `POSTGRES_PASSWORD=${password}`];
    return compose(["exec", "-T", ...options, "db", "sh", "-c",
      'PGPASSWORD="$POSTGRES_PASSWORD" PGCONNECT_TIMEOUT=3 psql -X -w -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atqc "$1"',
      "sh", sql], allowFailure);
  }
  const up = () => compose(["up", "-d", "--wait", "--wait-timeout", "30", "db"]);
  const repair = (allowFailure = false) => compose(["run", "--rm", "--no-deps", "--user", "postgres",
    "--entrypoint", "bash", "db", "/opt/inzet/postgres/repair-login.sh"], allowFailure);
  try {
    config();
    const resolved = JSON.parse(compose(["config", "--format", "json"]).stdout);
    assert.deepEqual(resolved.services.db.ports ?? [], []);
    assert.deepEqual(Object.keys(resolved.services.db.networks), ["database"]);
    assert.equal(resolved.networks.database.internal, true);
    up();
    assert.doesNotMatch(compose(["exec", "-T", "db", "ip", "route"]).stdout, /^default /m);
    assert.doesNotMatch(compose(["exec", "-T", "db", "ip", "-6", "route"]).stdout, /^default /m);
    query("CREATE TABLE preserved (value text); INSERT INTO preserved VALUES ('keep me')");
    // Changing .env alone must not falsely report an existing volume as healthy.
    compose(["stop", "db"]);
    env.POSTGRES_PASSWORD = "new-p@ss:/?#%$'\\ word";
    repair();
    up();
    assert.equal(query("SELECT value FROM preserved").stdout.trim(), "keep me");
    assert.notEqual(query("SELECT 1", true, "old-test-password").status, 0);
    console.log("Existing volume: explicit repair applies configured password, old password rejected, data preserved.");

    compose(["restart", "db"]);
    up();
    assert.equal(query("SELECT value FROM preserved").stdout.trim(), "keep me");
    console.log("Restart: password and data preserved.");

    // A listener alone must not pass health when its password has drifted.
    query("ALTER ROLE CURRENT_USER PASSWORD 'unexpected-test-password'");
    assert.notEqual(query("SELECT 1", true).status, 0);
    const health = JSON.parse(compose(["config", "--format", "json"]).stdout).services.db.healthcheck.test[1];
    assert.notEqual(compose(["exec", "-T", "db", "sh", "-c", health], true).status, 0);
    compose(["stop", "db"]);
    repair();
    up();
    assert.equal(query("SELECT 1").stdout.trim(), "1");
    console.log("Password drift: real healthcheck fails, explicit repair restores configured password.");

    query("ALTER ROLE CURRENT_USER NOLOGIN");
    compose(["stop", "db"]);
    repair();
    up();
    assert.equal(query("SELECT value FROM preserved").stdout.trim(), "keep me");
    assert.notEqual(repair(true).status, 0, "repair must refuse a running database");
    console.log("Disabled login: offline repair restores configured password and preserves data.");

    // Restoring LOGIN must not elevate a non-superuser, even with a quoted name.
    query('CREATE ROLE "Other ""Login""" NOLOGIN NOSUPERUSER');
    compose(["stop", "db"]);
    const user = env.POSTGRES_USER;
    env.POSTGRES_USER = 'Other "Login"';
    repair();
    up();
    assert.equal(query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user").stdout.trim(), "f");
    compose(["stop", "db"]);
    env.POSTGRES_USER = "missing-role";
    assert.notEqual(repair(true).status, 0, "SQL errors must not report repair success");
    env.POSTGRES_USER = user;

    compose(["down", "--volumes"]);
    up();
    assert.equal(query("SELECT current_database()").stdout.trim(), env.POSTGRES_DB);
    console.log("Fresh volume: initializes successfully with special characters in credentials.");
  } catch (error) {
    console.error(compose(["logs", "--tail=20", "db"], true).stdout);
    throw error;
  } finally {
    compose(["down", "--volumes", "--remove-orphans"], true);
    rmSync(dir, { recursive: true, force: true });
  }
});
