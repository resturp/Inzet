import assert from "node:assert/strict";
import test from "node:test";
import {
  areAliasSetsEqual,
  hasTaskPermissionFromMap,
  primaryCoordinatorAlias,
  resolveEffectiveCoordinatorAliasesFromMap
} from "../src/lib/authorization";

type TestTask = {
  id: string;
  parentId: string | null;
  ownCoordinatorAliases: string[];
};

function taskMap(tasks: TestTask[]): Map<string, TestTask> {
  return new Map(tasks.map((task) => [task.id, task]));
}

test("coordinator op taak krijgt alle rechten", () => {
  const tasks = taskMap([
    { id: "task-1", parentId: null, ownCoordinatorAliases: ["jan"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("jan", "task-1", "READ", tasks), true);
  assert.equal(hasTaskPermissionFromMap("jan", "task-1", "OPEN", tasks), true);
  assert.equal(hasTaskPermissionFromMap("jan", "task-1", "MANAGE", tasks), true);
});

test("niet-coordinator op taak met coordinatoren houdt alleen leesrecht", () => {
  const tasks = taskMap([
    { id: "task-1", parentId: null, ownCoordinatorAliases: ["jan", "piet"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("klaas", "task-1", "READ", tasks), true);
  assert.equal(hasTaskPermissionFromMap("klaas", "task-1", "OPEN", tasks), true);
  assert.equal(hasTaskPermissionFromMap("klaas", "task-1", "MANAGE", tasks), false);
});

test("zonder coordinatoren op taak wordt recht via parent geerfd", () => {
  const tasks = taskMap([
    { id: "parent", parentId: null, ownCoordinatorAliases: ["jan"] },
    { id: "child", parentId: "parent", ownCoordinatorAliases: [] }
  ]);

  assert.equal(hasTaskPermissionFromMap("jan", "child", "MANAGE", tasks), true);
  assert.equal(hasTaskPermissionFromMap("jan", "child", "OPEN", tasks), true);
});

test("zonder coordinatoren op taak erft niet-coordinator parent alleen leesrecht", () => {
  const tasks = taskMap([
    { id: "parent", parentId: null, ownCoordinatorAliases: ["jan"] },
    { id: "child", parentId: "parent", ownCoordinatorAliases: [] }
  ]);

  assert.equal(hasTaskPermissionFromMap("klaas", "child", "READ", tasks), true);
  assert.equal(hasTaskPermissionFromMap("klaas", "child", "OPEN", tasks), true);
  assert.equal(hasTaskPermissionFromMap("klaas", "child", "MANAGE", tasks), false);
});

test("zonder coordinatoren en zonder parent levert geen rechten", () => {
  const tasks = taskMap([
    { id: "task-1", parentId: null, ownCoordinatorAliases: [] }
  ]);

  assert.equal(hasTaskPermissionFromMap("jan", "task-1", "READ", tasks), false);
  assert.equal(hasTaskPermissionFromMap("jan", "task-1", "OPEN", tasks), false);
  assert.equal(hasTaskPermissionFromMap("jan", "task-1", "MANAGE", tasks), false);
});

test("meerlagige parent-keten erft rechten tot eerste taak met coordinatoren", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, ownCoordinatorAliases: ["jan"] },
    { id: "mid", parentId: "root", ownCoordinatorAliases: [] },
    { id: "leaf", parentId: "mid", ownCoordinatorAliases: [] }
  ]);

  assert.equal(hasTaskPermissionFromMap("jan", "leaf", "MANAGE", tasks), true);
  assert.equal(hasTaskPermissionFromMap("klaas", "leaf", "MANAGE", tasks), false);
  assert.equal(hasTaskPermissionFromMap("klaas", "leaf", "OPEN", tasks), true);
  assert.equal(hasTaskPermissionFromMap("klaas", "leaf", "READ", tasks), true);
});

test("coordinatoren op A beperken parent-coordinatoren tot leesrecht op A en diens subtaken", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, ownCoordinatorAliases: ["edgar"] },
    { id: "a", parentId: "root", ownCoordinatorAliases: ["thomas"] },
    { id: "a-child", parentId: "a", ownCoordinatorAliases: [] },
    { id: "a-child-explicit", parentId: "a", ownCoordinatorAliases: ["edgar"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("edgar", "a", "READ", tasks), true);
  assert.equal(hasTaskPermissionFromMap("edgar", "a", "OPEN", tasks), true);
  assert.equal(hasTaskPermissionFromMap("edgar", "a", "MANAGE", tasks), false);

  assert.equal(hasTaskPermissionFromMap("edgar", "a-child", "READ", tasks), true);
  assert.equal(hasTaskPermissionFromMap("edgar", "a-child", "OPEN", tasks), true);
  assert.equal(hasTaskPermissionFromMap("edgar", "a-child", "MANAGE", tasks), false);

  assert.equal(hasTaskPermissionFromMap("edgar", "a-child-explicit", "READ", tasks), true);
  assert.equal(hasTaskPermissionFromMap("edgar", "a-child-explicit", "OPEN", tasks), true);
  assert.equal(hasTaskPermissionFromMap("edgar", "a-child-explicit", "MANAGE", tasks), true);
});

test("cycle in parent-structuur stopt veilig zonder rechten", () => {
  const tasks = taskMap([
    { id: "loop", parentId: "loop", ownCoordinatorAliases: [] }
  ]);

  assert.equal(hasTaskPermissionFromMap("jan", "loop", "MANAGE", tasks), false);
  assert.equal(hasTaskPermissionFromMap("jan", "loop", "OPEN", tasks), false);
});

test("effective coordinators resolver pakt eerste coordinator-set in de keten", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, ownCoordinatorAliases: ["piet", "jan", "jan"] },
    { id: "child", parentId: "root", ownCoordinatorAliases: [] }
  ]);

  const effective = resolveEffectiveCoordinatorAliasesFromMap("child", tasks);
  assert.deepEqual(effective, ["jan", "piet"]);
  assert.equal(primaryCoordinatorAlias(effective), "jan");
});

test("alias set vergelijking is volgorde-onafhankelijk bij gelijke cardinaliteit", () => {
  assert.equal(areAliasSetsEqual(["jan", "piet"], ["piet", "jan"]), true);
  assert.equal(areAliasSetsEqual(["jan", "piet", "jan"], ["piet", "jan"]), false);
});
