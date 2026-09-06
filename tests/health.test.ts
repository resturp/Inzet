import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../src/lib/prisma";
import { GET } from "../src/app/api/health/route";

function mockQuery(t: TestContext, implementation: () => Promise<unknown>) {
  const original = prisma.$queryRaw;
  const query = t.mock.fn(implementation);
  prisma.$queryRaw = query as typeof prisma.$queryRaw;
  t.after(() => { prisma.$queryRaw = original; });
  return query;
}

test("health reports success only after a database query", async (t) => {
  const query = mockQuery(t, async () => [{ "?column?": 1 }]);
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(query.mock.callCount(), 1);
});

test("health reports database failure without exposing credentials", async (t) => {
  mockQuery(t, async () => { throw new Error("P1000 password=secret"); });
  const response = await GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false, service: "inzet-vrijwilligersportaal", database: "unavailable"
  });
});

test("health times out when the database query hangs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockQuery(t, () => new Promise(() => {}));
  const response = GET();
  t.mock.timers.tick(3000);
  assert.equal((await response).status, 503);
});
