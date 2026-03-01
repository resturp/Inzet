import assert from "node:assert/strict";
import test from "node:test";
import {
  areAliasSetsEqual,
  canCreateSubtaskFromMap,
  canEditTaskCoordinatorsFromMap,
  hasTaskPermissionFromMap,
  primaryCoordinatorAlias,
  resolveEffectiveCoordinatorAliasesFromMap,
  resolveOrganizerAliasesFromMap
} from "../src/lib/authorization";

type TestTask = {
  id: string;
  parentId: string | null;
  coordinationType?: "DELEGEREN" | "ORGANISEREN";
  ownCoordinatorAliases: string[];
};

type ResolvedTestTask = Omit<TestTask, "coordinationType"> & {
  coordinationType: "DELEGEREN" | "ORGANISEREN" | null;
};

function taskMap(tasks: TestTask[]): Map<string, ResolvedTestTask> {
  return new Map(
    tasks.map((task) => [
      task.id,
      {
        ...task,
        coordinationType: task.coordinationType ?? null
      }
    ])
  );
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

test("organiseren op parent houdt parent-coordinator beheersbevoegd op expliciete child", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "ORGANISEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "child", parentId: "root", ownCoordinatorAliases: ["thomas"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("edgar", "child", "MANAGE", tasks), true);
  assert.deepEqual(resolveEffectiveCoordinatorAliasesFromMap("child", tasks), ["edgar", "thomas"]);
  assert.deepEqual(resolveOrganizerAliasesFromMap("child", tasks), ["edgar"]);
  assert.equal(canEditTaskCoordinatorsFromMap("edgar", "child", tasks), true);
});

test("oningestelde werkwijze erft organiseren van voorouder", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "ORGANISEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "mid", parentId: "root", ownCoordinatorAliases: [] },
    { id: "leaf", parentId: "mid", ownCoordinatorAliases: ["thomas"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("edgar", "leaf", "MANAGE", tasks), true);
  assert.deepEqual(resolveEffectiveCoordinatorAliasesFromMap("leaf", tasks), ["edgar", "thomas"]);
  assert.deepEqual(resolveOrganizerAliasesFromMap("leaf", tasks), ["edgar"]);
});

test("delegeren op parent geeft child-beheer exclusief aan child-coordinator", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "DELEGEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "child", parentId: "root", ownCoordinatorAliases: ["thomas"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("edgar", "child", "MANAGE", tasks), false);
  assert.deepEqual(resolveEffectiveCoordinatorAliasesFromMap("child", tasks), ["thomas"]);
});

test("expliciet delegeren op child doorbreekt organiseren-cumulatie van parent", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "ORGANISEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "child", parentId: "root", coordinationType: "DELEGEREN", ownCoordinatorAliases: ["thomas"] },
    { id: "leaf", parentId: "child", ownCoordinatorAliases: [] }
  ]);

  assert.equal(hasTaskPermissionFromMap("edgar", "child", "MANAGE", tasks), false);
  assert.equal(hasTaskPermissionFromMap("edgar", "leaf", "MANAGE", tasks), false);
  assert.deepEqual(resolveEffectiveCoordinatorAliasesFromMap("child", tasks), ["thomas"]);
  assert.deepEqual(resolveEffectiveCoordinatorAliasesFromMap("leaf", tasks), ["thomas"]);
});

test("cycle in parent-structuur stopt veilig zonder rechten", () => {
  const tasks = taskMap([
    { id: "loop", parentId: "loop", ownCoordinatorAliases: [] }
  ]);

  assert.equal(hasTaskPermissionFromMap("jan", "loop", "MANAGE", tasks), false);
  assert.equal(hasTaskPermissionFromMap("jan", "loop", "OPEN", tasks), false);
  assert.deepEqual(resolveOrganizerAliasesFromMap("loop", tasks), []);
});

test("organisator kan coordinatorlijst aanpassen op taak die effectief organiseren is", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "ORGANISEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "child", parentId: "root", ownCoordinatorAliases: ["thomas"] }
  ]);

  // Edgar is organisator via dichtstbijzijnde expliciete parent (root ORGANISEREN).
  assert.deepEqual(resolveOrganizerAliasesFromMap("child", tasks), ["edgar"]);
  assert.equal(canEditTaskCoordinatorsFromMap("edgar", "child", tasks), true);
  assert.equal(canEditTaskCoordinatorsFromMap("jan", "child", tasks), false);
});

test("coordinatorlijst aanpassen staat uit als taak effectief delegeren is", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "ORGANISEREN", ownCoordinatorAliases: ["edgar"] },
    {
      id: "child",
      parentId: "root",
      coordinationType: "DELEGEREN",
      ownCoordinatorAliases: ["edgar", "thomas"]
    }
  ]);

  assert.equal(hasTaskPermissionFromMap("edgar", "child", "MANAGE", tasks), true);
  assert.equal(canEditTaskCoordinatorsFromMap("edgar", "child", tasks), false);
});

test("organiseren: toegewezen blad-coordinator krijgt niet automatisch subtaakrechten", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "ORGANISEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "leaf", parentId: "root", ownCoordinatorAliases: ["thomas"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("thomas", "leaf", "MANAGE", tasks), true);
  assert.equal(canCreateSubtaskFromMap("thomas", "leaf", tasks), false);
});

test("organiseren: geen parent-coordinatierecht betekent geen subtaak-plus op expliciete child", () => {
  const tasks = taskMap([
    { id: "besturen", parentId: null, ownCoordinatorAliases: ["edgar"] },
    { id: "bestuur", parentId: "besturen", ownCoordinatorAliases: ["edgar"] },
    {
      id: "technische-zaken",
      parentId: "bestuur",
      coordinationType: "ORGANISEREN",
      ownCoordinatorAliases: ["erik"]
    },
    { id: "tc-jongens", parentId: "technische-zaken", ownCoordinatorAliases: ["mark"] },
    { id: "jongens-b2", parentId: "tc-jongens", ownCoordinatorAliases: ["isaura"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("isaura", "tc-jongens", "MANAGE", tasks), false);
  assert.equal(hasTaskPermissionFromMap("isaura", "jongens-b2", "MANAGE", tasks), true);
  assert.equal(canCreateSubtaskFromMap("isaura", "jongens-b2", tasks), false);
});

test("organiseren: bestaande effectieve coordinator behoudt subtaakrechten", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "ORGANISEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "leaf", parentId: "root", ownCoordinatorAliases: ["thomas"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("edgar", "leaf", "MANAGE", tasks), true);
  assert.equal(canCreateSubtaskFromMap("edgar", "leaf", tasks), true);
});

test("delegeren: expliciete coordinator mag subtaken maken", () => {
  const tasks = taskMap([
    { id: "root", parentId: null, coordinationType: "DELEGEREN", ownCoordinatorAliases: ["edgar"] },
    { id: "leaf", parentId: "root", ownCoordinatorAliases: ["thomas"] }
  ]);

  assert.equal(hasTaskPermissionFromMap("thomas", "leaf", "MANAGE", tasks), true);
  assert.equal(canCreateSubtaskFromMap("thomas", "leaf", tasks), true);
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
