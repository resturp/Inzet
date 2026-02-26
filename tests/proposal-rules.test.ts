import assert from "node:assert/strict";
import test from "node:test";
import {
  canActorDecideProposal,
  resolveCoordinatorAliasesAfterAccept,
  resolveOwnCoordinatorAliasesAfterRelease
} from "../src/lib/rules";

test("proposer == proposed: alleen effectieve coordinator mag beslissen", () => {
  assert.equal(
    canActorDecideProposal({
      proposerAlias: "Thomas",
      proposedAlias: "Thomas",
      actorAlias: "Thomas",
      effectiveCoordinatorAliases: ["Edgar", "Jan"]
    }),
    false
  );

  assert.equal(
    canActorDecideProposal({
      proposerAlias: "Thomas",
      proposedAlias: "Thomas",
      actorAlias: "Edgar",
      effectiveCoordinatorAliases: ["Edgar", "Jan"]
    }),
    true
  );
});

test("proposer != proposed: voorgesteld lid of coordinator beslist", () => {
  assert.equal(
    canActorDecideProposal({
      proposerAlias: "Edgar",
      proposedAlias: "Thomas",
      actorAlias: "Thomas",
      effectiveCoordinatorAliases: ["Edgar"]
    }),
    true
  );

  assert.equal(
    canActorDecideProposal({
      proposerAlias: "Edgar",
      proposedAlias: "Thomas",
      actorAlias: "Edgar",
      effectiveCoordinatorAliases: ["Edgar"]
    }),
    true
  );
});

test("niet-coordinator en niet-voorgesteld lid kan voorstel niet beslissen", () => {
  assert.equal(
    canActorDecideProposal({
      proposerAlias: "Edgar",
      proposedAlias: "Thomas",
      actorAlias: "Jan",
      effectiveCoordinatorAliases: ["Edgar"]
    }),
    false
  );
});

test("accept voegt voorgesteld lid toe aan bestaande effectieve set", () => {
  const result = resolveCoordinatorAliasesAfterAccept({
    proposedAlias: "Thomas",
    currentOwnCoordinatorAliases: ["Edgar", "Thomas"]
  });

  assert.deepEqual(result, ["Edgar", "Thomas"]);
});

test("accept op geerfde taak zet alleen voorgestelde persoon als eigenaar", () => {
  const result = resolveCoordinatorAliasesAfterAccept({
    proposedAlias: "Thomas",
    currentOwnCoordinatorAliases: []
  });

  assert.deepEqual(result, ["Thomas"]);
});

test("accept op expliciete child-task behoudt bestaande en voegt nieuwe toe", () => {
  const result = resolveCoordinatorAliasesAfterAccept({
    proposedAlias: "Thomas",
    currentOwnCoordinatorAliases: ["Edgar"]
  });

  assert.deepEqual(result, ["Edgar", "Thomas"]);
});

test("release verwijdert actor uit effectieve set", () => {
  const result = resolveOwnCoordinatorAliasesAfterRelease({
    actorAlias: "Thomas",
    currentEffectiveCoordinatorAliases: ["Edgar", "Thomas"],
    parentEffectiveCoordinatorAliases: ["Edgar", "Thomas"]
  });

  assert.deepEqual(result, { ownCoordinatorAliases: ["Edgar"], error: null });
});

test("release kan niet als parent alleen actor heeft", () => {
  const result = resolveOwnCoordinatorAliasesAfterRelease({
    actorAlias: "Thomas",
    currentEffectiveCoordinatorAliases: ["Thomas"],
    parentEffectiveCoordinatorAliases: ["Thomas"]
  });

  assert.deepEqual(result, {
    ownCoordinatorAliases: null,
    error: "Taak kan je niet loslaten: parent-taak heeft alleen jou als coordinator."
  });
});

test("release door laatste expliciete coordinator zet geen parent-effectieve aliases expliciet op child", () => {
  const result = resolveOwnCoordinatorAliasesAfterRelease({
    actorAlias: "Thomas",
    currentEffectiveCoordinatorAliases: ["Thomas"],
    parentEffectiveCoordinatorAliases: ["Edgar", "Jan"]
  });

  assert.deepEqual(result, { ownCoordinatorAliases: [], error: null });
});
