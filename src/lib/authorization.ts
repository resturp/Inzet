import { prisma } from "@/lib/prisma";

type MinimalTask = {
  id: string;
  title?: string;
  parentId: string | null;
  coordinationType: "DELEGEREN" | "ORGANISEREN" | null;
  ownCoordinatorAliases: string[];
};

type EffectiveTaskCoordinationType = "DELEGEREN" | "ORGANISEREN";

export type TaskPermission = "READ" | "OPEN" | "MANAGE";

const BESTUUR_TASK_TITLE = "bestuur";
const ROOT_GOVERNANCE_TASK_TITLE = "besturen vereniging";

function isReadOpenPermission(permission: TaskPermission): boolean {
  return permission === "READ" || permission === "OPEN";
}

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function normalizeTaskTitle(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("nl-NL");
}

function hasPotentialTaskPermission(alias: string, permission: TaskPermission): boolean {
  void alias;
  void permission;
  // Current model: iedereen heeft potentieel alle rechten; ownership bepaalt of het definitief wordt.
  return true;
}

function normalizeExplicitCoordinationType(value: MinimalTask["coordinationType"] | undefined) {
  if (value === "DELEGEREN" || value === "ORGANISEREN") {
    return value;
  }
  return null;
}

function buildTaskPathFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): MinimalTask[] | null {
  const leafToRoot: MinimalTask[] = [];
  const visited = new Set<string>();
  let current = tasksById.get(taskId);

  while (current) {
    if (visited.has(current.id)) {
      return null;
    }
    visited.add(current.id);
    leafToRoot.push(current);
    current = current.parentId ? tasksById.get(current.parentId) : undefined;
  }

  return leafToRoot.reverse();
}

function resolveTaskAccessContextFromPath(pathFromRoot: readonly MinimalTask[]) {
  let effectiveCoordinatorAliases: string[] = [];
  let hasAnyCoordinator = false;
  let inheritedCoordinationType: EffectiveTaskCoordinationType = "DELEGEREN";

  for (let index = 0; index < pathFromRoot.length; index += 1) {
    const current = pathFromRoot[index];
    const currentEffectiveCoordinationType: EffectiveTaskCoordinationType =
      normalizeExplicitCoordinationType(current.coordinationType) ?? inheritedCoordinationType;
    const ownCoordinatorAliases = uniqueSortedAliases(current.ownCoordinatorAliases);
    if (ownCoordinatorAliases.length === 0) {
      inheritedCoordinationType = currentEffectiveCoordinationType;
      continue;
    }

    hasAnyCoordinator = true;
    if (index === 0) {
      effectiveCoordinatorAliases = ownCoordinatorAliases;
      inheritedCoordinationType = currentEffectiveCoordinationType;
      continue;
    }

    if (inheritedCoordinationType === "ORGANISEREN") {
      effectiveCoordinatorAliases = uniqueSortedAliases([
        ...effectiveCoordinatorAliases,
        ...ownCoordinatorAliases
      ]);
      inheritedCoordinationType = currentEffectiveCoordinationType;
      continue;
    }

    effectiveCoordinatorAliases = ownCoordinatorAliases;
    inheritedCoordinationType = currentEffectiveCoordinationType;
  }

  return {
    hasAnyCoordinator,
    effectiveCoordinatorAliases,
    effectiveCoordinationType: inheritedCoordinationType
  };
}

function resolveOrganizerAliasesFromPath(pathFromRoot: readonly MinimalTask[]): string[] {
  if (pathFromRoot.length < 2) {
    return [];
  }

  // Organizer anchor = closest parent with explicit ORGANISEREN (task itself excluded).
  for (let index = pathFromRoot.length - 2; index >= 0; index -= 1) {
    const candidate = pathFromRoot[index];
    if (candidate.coordinationType !== "ORGANISEREN") {
      continue;
    }
    return resolveTaskAccessContextFromPath(pathFromRoot.slice(0, index + 1)).effectiveCoordinatorAliases;
  }

  return [];
}

function resolveTaskAccessContextFromMap(taskId: string, tasksById: Map<string, MinimalTask>) {
  const pathFromRoot = buildTaskPathFromMap(taskId, tasksById);
  if (!pathFromRoot) {
    return {
      hasAnyCoordinator: false,
      effectiveCoordinatorAliases: [],
      effectiveCoordinationType: "DELEGEREN" as const
    };
  }
  return resolveTaskAccessContextFromPath(pathFromRoot);
}

function resolveTaskDepthFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>,
  depthByTaskId: Map<string, number | null>,
  activeStack: Set<string>
): number | null {
  const cachedDepth = depthByTaskId.get(taskId);
  if (cachedDepth !== undefined) {
    return cachedDepth;
  }

  if (activeStack.has(taskId)) {
    depthByTaskId.set(taskId, null);
    return null;
  }

  const task = tasksById.get(taskId);
  if (!task) {
    depthByTaskId.set(taskId, null);
    return null;
  }

  activeStack.add(taskId);
  const depth = task.parentId
    ? (() => {
        const parentDepth = resolveTaskDepthFromMap(task.parentId!, tasksById, depthByTaskId, activeStack);
        return parentDepth === null ? null : parentDepth + 1;
      })()
    : 0;
  activeStack.delete(taskId);
  depthByTaskId.set(taskId, depth);

  return depth;
}

export function resolveBestuurAliasesFromMap(tasksById: Map<string, MinimalTask>): string[] {
  const depthByTaskId = new Map<string, number | null>();
  let shallowestDepth: number | null = null;
  const bestuurTaskIds: string[] = [];

  for (const task of tasksById.values()) {
    if (normalizeTaskTitle(task.title) !== BESTUUR_TASK_TITLE) {
      continue;
    }
    const depth = resolveTaskDepthFromMap(task.id, tasksById, depthByTaskId, new Set<string>());
    if (depth === null) {
      continue;
    }
    if (shallowestDepth === null || depth < shallowestDepth) {
      shallowestDepth = depth;
      bestuurTaskIds.splice(0, bestuurTaskIds.length, task.id);
      continue;
    }
    if (depth === shallowestDepth) {
      bestuurTaskIds.push(task.id);
    }
  }

  const anchorTaskIds =
    bestuurTaskIds.length > 0
      ? bestuurTaskIds
      : Array.from(tasksById.values())
          .filter(
            (task) =>
              task.parentId === null && normalizeTaskTitle(task.title) === ROOT_GOVERNANCE_TASK_TITLE
          )
          .map((task) => task.id);

  const bestuurAliases = anchorTaskIds.flatMap(
    (taskId) => resolveTaskAccessContextFromMap(taskId, tasksById).effectiveCoordinatorAliases
  );
  return uniqueSortedAliases(bestuurAliases);
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
  const bestuurAliases = await resolveBestuurAliases();
  return bestuurAliases.includes(alias);
}

export async function resolveBestuurAliases(): Promise<string[]> {
  const tasks = await prisma.task.findMany({
    select: {
      id: true,
      title: true,
      parentId: true,
      coordinationType: true,
      ownCoordinators: {
        select: { userAlias: true }
      }
    }
  });

  const tasksById = new Map<string, MinimalTask>(
    tasks.map((task) => [
      task.id,
      {
        id: task.id,
        title: task.title,
        parentId: task.parentId,
        coordinationType: normalizeExplicitCoordinationType(task.coordinationType),
        ownCoordinatorAliases: uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias))
      }
    ])
  );

  return resolveBestuurAliasesFromMap(tasksById);
}

export async function isBestuurAlias(alias: string): Promise<boolean> {
  const bestuurAliases = await resolveBestuurAliases();
  return bestuurAliases.includes(alias);
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

  const access = resolveTaskAccessContextFromMap(taskId, tasksById);
  if (permission === "MANAGE") {
    return access.effectiveCoordinatorAliases.includes(alias);
  }
  return isReadOpenPermission(permission) && access.hasAnyCoordinator;
}

export function resolveEffectiveCoordinatorAliasesFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): string[] {
  return resolveTaskAccessContextFromMap(taskId, tasksById).effectiveCoordinatorAliases;
}

export function resolveEffectiveCoordinationTypeFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): EffectiveTaskCoordinationType {
  return resolveTaskAccessContextFromMap(taskId, tasksById).effectiveCoordinationType;
}

export function resolveEffectiveCoordinatorAliasFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): string | null {
  return primaryCoordinatorAlias(resolveEffectiveCoordinatorAliasesFromMap(taskId, tasksById));
}

export function resolveOrganizerAliasesFromMap(
  taskId: string,
  tasksById: Map<string, MinimalTask>
): string[] {
  const pathFromRoot = buildTaskPathFromMap(taskId, tasksById);
  if (!pathFromRoot) {
    return [];
  }
  return resolveOrganizerAliasesFromPath(pathFromRoot);
}

export function canEditTaskCoordinatorsFromMap(
  alias: string,
  taskId: string,
  tasksById: Map<string, MinimalTask>
): boolean {
  const access = resolveTaskAccessContextFromMap(taskId, tasksById);
  if (access.effectiveCoordinationType !== "ORGANISEREN") {
    return false;
  }

  if (hasTaskPermissionFromMap(alias, taskId, "MANAGE", tasksById)) {
    return true;
  }
  const organizerAliases = resolveOrganizerAliasesFromMap(taskId, tasksById);
  return organizerAliases.includes(alias);
}

async function fetchMinimalTask(taskId: string): Promise<MinimalTask | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      parentId: true,
      coordinationType: true,
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
    coordinationType: normalizeExplicitCoordinationType(task.coordinationType),
    ownCoordinatorAliases: uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias))
  };
}

export async function resolveEffectiveCoordinatorAliases(taskId: string): Promise<string[]> {
  const leafToRoot: MinimalTask[] = [];
  const visited = new Set<string>();
  let current = await fetchMinimalTask(taskId);

  while (current) {
    if (visited.has(current.id)) {
      return [];
    }
    visited.add(current.id);
    leafToRoot.push(current);
    current = current.parentId ? await fetchMinimalTask(current.parentId) : null;
  }

  const access = resolveTaskAccessContextFromPath(leafToRoot.reverse());
  return access.effectiveCoordinatorAliases;
}

export async function resolveEffectiveCoordinatorAlias(taskId: string): Promise<string | null> {
  const aliases = await resolveEffectiveCoordinatorAliases(taskId);
  return primaryCoordinatorAlias(aliases);
}

export async function resolveEffectiveCoordinationType(
  taskId: string
): Promise<EffectiveTaskCoordinationType> {
  const leafToRoot: MinimalTask[] = [];
  const visited = new Set<string>();
  let current = await fetchMinimalTask(taskId);

  while (current) {
    if (visited.has(current.id)) {
      return "DELEGEREN";
    }
    visited.add(current.id);
    leafToRoot.push(current);
    current = current.parentId ? await fetchMinimalTask(current.parentId) : null;
  }

  return resolveTaskAccessContextFromPath(leafToRoot.reverse()).effectiveCoordinationType;
}

export async function resolveOrganizerAliases(taskId: string): Promise<string[]> {
  const leafToRoot: MinimalTask[] = [];
  const visited = new Set<string>();
  let current = await fetchMinimalTask(taskId);

  while (current) {
    if (visited.has(current.id)) {
      return [];
    }
    visited.add(current.id);
    leafToRoot.push(current);
    current = current.parentId ? await fetchMinimalTask(current.parentId) : null;
  }

  return resolveOrganizerAliasesFromPath(leafToRoot.reverse());
}

export async function canEditTaskCoordinatorsByOrganization(
  alias: string,
  taskId: string
): Promise<boolean> {
  const effectiveCoordinationType = await resolveEffectiveCoordinationType(taskId);
  if (effectiveCoordinationType !== "ORGANISEREN") {
    return false;
  }

  if (await hasTaskPermission(alias, taskId, "MANAGE")) {
    return true;
  }

  const organizerAliases = await resolveOrganizerAliases(taskId);
  return organizerAliases.includes(alias);
}

export async function hasTaskPermission(
  alias: string,
  taskId: string,
  permission: TaskPermission
): Promise<boolean> {
  if (!hasPotentialTaskPermission(alias, permission)) {
    return false;
  }

  const leafToRoot: MinimalTask[] = [];
  const visited = new Set<string>();
  let current = await fetchMinimalTask(taskId);

  while (current) {
    if (visited.has(current.id)) {
      return false;
    }
    visited.add(current.id);
    leafToRoot.push(current);
    current = current.parentId ? await fetchMinimalTask(current.parentId) : null;
  }

  const access = resolveTaskAccessContextFromPath(leafToRoot.reverse());
  if (permission === "MANAGE") {
    return access.effectiveCoordinatorAliases.includes(alias);
  }

  return isReadOpenPermission(permission) && access.hasAnyCoordinator;
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
