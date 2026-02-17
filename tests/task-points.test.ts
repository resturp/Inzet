import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePointsFromParent,
  parseStoredPoints,
  pointsToStorage,
  remainingOwnPoints,
  sumStoredPoints
} from "../src/lib/task-points";

test("allocate op beschikbaar saldo trekt punten af bij voldoende ruimte", () => {
  const result = allocatePointsFromParent({
    availablePoints: 600,
    requestedPoints: 100
  });

  assert.deepEqual(result, {
    availablePointsAfter: 500,
    assignedPoints: 100,
    zeroed: false
  });
});

test("allocate zet nieuwe taak op 0 bij tekort", () => {
  const result = allocatePointsFromParent({
    availablePoints: 80,
    requestedPoints: 100
  });

  assert.deepEqual(result, {
    availablePointsAfter: 80,
    assignedPoints: 0,
    zeroed: true
  });
});

test("remaining own points berekent eigen min uitgegeven subtaken", () => {
  const result = remainingOwnPoints({
    ownPoints: 600,
    issuedToDirectSubtasks: 200
  });

  assert.equal(result, 400);
});

test("parse en storage normaliseren negatieve en ongeldige waarden", () => {
  assert.equal(parseStoredPoints("-10"), 0);
  assert.equal(parseStoredPoints("abc"), 0);
  assert.equal(pointsToStorage(-99), "0");
});

test("sum stored points telt Decimal/string/number veilig op", () => {
  const total = sumStoredPoints([
    { toString: () => "40.5" },
    "20",
    -5,
    "abc"
  ]);

  assert.equal(total, 60.5);
});
