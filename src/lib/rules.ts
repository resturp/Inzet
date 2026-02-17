function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function areAliasSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const normalizedLeft = uniqueSortedAliases(left);
  const normalizedRight = uniqueSortedAliases(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((alias, index) => alias === normalizedRight[index]);
}

export function canActorDecideProposal(params: {
  proposerAlias: string;
  proposedAlias: string;
  actorAlias: string;
  effectiveCoordinatorAliases: string[];
}): boolean {
  const { proposerAlias, proposedAlias, actorAlias, effectiveCoordinatorAliases } = params;
  if (proposerAlias === proposedAlias) {
    return effectiveCoordinatorAliases.includes(actorAlias);
  }
  return actorAlias === proposedAlias;
}

export function resolveCoordinatorAliasesAfterAccept(params: {
  proposedAlias: string;
  currentOwnCoordinatorAliases: string[];
}): string[] {
  return uniqueSortedAliases([
    ...params.currentOwnCoordinatorAliases,
    params.proposedAlias
  ]);
}

export function resolveOwnCoordinatorAliasesAfterRelease(params: {
  actorAlias: string;
  currentEffectiveCoordinatorAliases: string[];
  parentEffectiveCoordinatorAliases: string[];
}):
  | {
      ownCoordinatorAliases: string[];
      error: null;
    }
  | {
      ownCoordinatorAliases: null;
      error: string;
    } {
  const nextEffective = uniqueSortedAliases(
    params.currentEffectiveCoordinatorAliases.filter((alias) => alias !== params.actorAlias)
  );

  if (nextEffective.length === 0) {
    const parentWithoutActor = uniqueSortedAliases(
      params.parentEffectiveCoordinatorAliases.filter((alias) => alias !== params.actorAlias)
    );
    if (parentWithoutActor.length > 0) {
      return { ownCoordinatorAliases: parentWithoutActor, error: null };
    }
    if (params.parentEffectiveCoordinatorAliases.includes(params.actorAlias)) {
      return {
        ownCoordinatorAliases: null,
        error: "Taak kan je niet loslaten: parent-taak heeft alleen jou als coordinator."
      };
    }
    return { ownCoordinatorAliases: [], error: null };
  }

  if (areAliasSetsEqual(nextEffective, params.parentEffectiveCoordinatorAliases)) {
    return { ownCoordinatorAliases: [], error: null };
  }

  return { ownCoordinatorAliases: nextEffective, error: null };
}
