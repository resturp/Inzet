import { prisma } from "@/lib/prisma";

type MinimalTask = {
  id: string;
  parentId: string | null;
  ownCoordinatorAlias: string | null;
};

export async function getRootTask() {
  return prisma.task.findFirst({
    where: { title: "Besturen vereniging", parentId: null },
    select: { id: true, ownCoordinatorAlias: true }
  });
}

export async function isRootOwner(alias: string): Promise<boolean> {
  const root = await getRootTask();
  if (!root) {
    return false;
  }
  return root.ownCoordinatorAlias === alias;
}

export function resolveEffectiveCoordinatorAliasFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): string | null {
  const visited = new Set<string>();
  let current = tasksById.get(taskId);

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);
    if (current.ownCoordinatorAlias) {
      return current.ownCoordinatorAlias;
    }
    current = current.parentId ? tasksById.get(current.parentId) : undefined;
  }

  return null;
}

export async function resolveEffectiveCoordinatorAlias(taskId: string): Promise<string | null> {
  const visited = new Set<string>();
  let current = (await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, parentId: true, ownCoordinatorAlias: true }
  })) as MinimalTask | null;

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);
    if (current.ownCoordinatorAlias) {
      return current.ownCoordinatorAlias;
    }
    if (!current.parentId) {
      break;
    }
    current = (await prisma.task.findUnique({
      where: { id: current.parentId },
      select: { id: true, parentId: true, ownCoordinatorAlias: true }
    })) as MinimalTask | null;
  }

  return null;
}

export async function canManageTaskByOwnership(
  alias: string,
  taskId: string
): Promise<boolean> {
  const effectiveCoordinatorAlias = await resolveEffectiveCoordinatorAlias(taskId);
  return effectiveCoordinatorAlias === alias;
}
