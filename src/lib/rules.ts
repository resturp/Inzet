export function canActorDecideProposal(params: {
  proposerAlias: string;
  proposedAlias: string;
  actorAlias: string;
  effectiveCoordinatorAlias: string;
}): boolean {
  const { proposerAlias, proposedAlias, actorAlias, effectiveCoordinatorAlias } = params;
  if (proposerAlias === proposedAlias) {
    return actorAlias === effectiveCoordinatorAlias;
  }
  return actorAlias === proposedAlias;
}
