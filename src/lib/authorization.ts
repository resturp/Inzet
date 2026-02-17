import { prisma } from "@/lib/prisma";

type MinimalTask = {
  id: string;
  parentId: string | null;
  ownCoordinatorAliases: string[];
};

export type TaskPermission = "READ" | "OPEN" | "MANAGE";

function isReadOpenPermission(permission: TaskPermission): boolean {
  return permission === "READ" || permission === "OPEN";
}

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function hasPotentialTaskPermission(alias: string, permission: TaskPermission): boolean {
  void alias;
  void permission;
  // Current model: iedereen heeft potentieel alle rechten; ownership bepaalt of het definitief wordt.
  return true;
}

export function primaryCoordinatorAlias(aliases: readonly string[]): string | null {
  return aliases.length > 0 ? aliases[0] : null;
}

export function areAliasSetsEqual(left: readonly string[], right: readonly string[]): boolean {
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

export async function getRootTask() {
  const root = await prisma.task.findFirst({
    where: { title: "Besturen vereniging", parentId: null },
    select: {
      id: true,
      ownCoordinators: {
        select: { userAlias: true }
      }
    }
  });

  if (!root) {
    return null;
  }

  return {
    id: root.id,
    ownCoordinatorAliases: uniqueSortedAliases(root.ownCoordinators.map((item) => item.userAlias))
  };
}

export async function isRootOwner(alias: string): Promise<boolean> {
  const root = await getRootTask();
  if (!root) {
    return false;
  }
  return root.ownCoordinatorAliases.includes(alias);
}

export function hasTaskPermissionFromMap(
  alias: string,
  taskId: string,
  permission: TaskPermission,
  tasksById: Map<string, MinimalTask>
): boolean {
  if (!hasPotentialTaskPermission(alias, permission)) {
    return false;
  }

  const visited = new Set<string>();
  let current = tasksById.get(taskId);

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);

    const ownCoordinatorAliases = uniqueSortedAliases(current.ownCoordinatorAliases);
    if (ownCoordinatorAliases.length > 0) {
      if (ownCoordinatorAliases.includes(alias)) {
        return true;
      }
      return isReadOpenPermission(permission);
    }

    if (!current.parentId) {
      break;
    }
    current = tasksById.get(current.parentId);
  }

  return false;
}

export function resolveEffectiveCoordinatorAliasesFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): string[] {
  const visited = new Set<string>();
  let current = tasksById.get(taskId);

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);
    if (current.ownCoordinatorAliases.length > 0) {
      return uniqueSortedAliases(current.ownCoordinatorAliases);
    }
    current = current.parentId ? tasksById.get(current.parentId) : undefined;
  }

  return [];
}

export function resolveEffectiveCoordinatorAliasFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): string | null {
  return primaryCoordinatorAlias(resolveEffectiveCoordinatorAliasesFromMap(taskId, tasksById));
}

async function fetchMinimalTask(taskId: string): Promise<MinimalTask | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      parentId: true,
      ownCoordinators: {
        select: { userAlias: true }
      }
    }
  });

  if (!task) {
    return null;
  }

  return {
    id: task.id,
    parentId: task.parentId,
    ownCoordinatorAliases: uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias))
  };
}

export async function resolveEffectiveCoordinatorAliases(taskId: string): Promise<string[]> {
  const visited = new Set<string>();
  let current = await fetchMinimalTask(taskId);

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);

    if (current.ownCoordinatorAliases.length > 0) {
      return current.ownCoordinatorAliases;
    }

    if (!current.parentId) {
      break;
    }

    current = await fetchMinimalTask(current.parentId);
  }

  return [];
}

export async function resolveEffectiveCoordinatorAlias(taskId: string): Promise<string | null> {
  const aliases = await resolveEffectiveCoordinatorAliases(taskId);
  return primaryCoordinatorAlias(aliases);
}

export async function hasTaskPermission(
  alias: string,
  taskId: string,
  permission: TaskPermission
): Promise<boolean> {
  if (!hasPotentialTaskPermission(alias, permission)) {
    return false;
  }

  const visited = new Set<string>();
  let current = await fetchMinimalTask(taskId);

  while (current) {
    if (visited.has(current.id)) {
      break;
    }
    visited.add(current.id);

    if (current.ownCoordinatorAliases.length > 0) {
      if (current.ownCoordinatorAliases.includes(alias)) {
        return true;
      }
      return isReadOpenPermission(permission);
    }

    if (!current.parentId) {
      break;
    }
    current = await fetchMinimalTask(current.parentId);
  }

  return false;
}

export async function canOpenTaskByOwnership(alias: string, taskId: string): Promise<boolean> {
  return hasTaskPermission(alias, taskId, "OPEN");
}

export async function canReadTaskByOwnership(alias: string, taskId: string): Promise<boolean> {
  return hasTaskPermission(alias, taskId, "READ");
}

export async function canManageTaskByOwnership(alias: string, taskId: string): Promise<boolean> {
  return hasTaskPermission(alias, taskId, "MANAGE");
}
