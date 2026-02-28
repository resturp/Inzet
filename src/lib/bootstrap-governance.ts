import { prisma } from "@/lib/prisma";

type MinimalTask = {
  id: string;
  parentId: string | null;
  ownCoordinatorAliases: string[];
};

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

async function normalizeInheritedOwners() {
  const tasksRaw = await prisma.task.findMany({
    select: {
      id: true,
      parentId: true,
      ownCoordinators: {
        select: { userAlias: true }
      }
    }
  });

  const tasks: MinimalTask[] = tasksRaw.map((task) => ({
    id: task.id,
    parentId: task.parentId,
    ownCoordinatorAliases: uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias))
  }));

  const byId = new Map(tasks.map((task) => [task.id, task]));

  function resolveEffective(taskId: string): string[] {
    const visited = new Set<string>();
    let current = byId.get(taskId);
    while (current) {
      if (visited.has(current.id)) {
        break;
      }
      visited.add(current.id);
      if (current.ownCoordinatorAliases.length > 0) {
        return current.ownCoordinatorAliases;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return [];
  }

  const toClear: string[] = [];
  for (const task of tasks) {
    if (!task.parentId || task.ownCoordinatorAliases.length === 0) {
      continue;
    }
    const parentEffective = resolveEffective(task.parentId);
    if (parentEffective.length > 0 && areAliasSetsEqual(task.ownCoordinatorAliases, parentEffective)) {
      toClear.push(task.id);
    }
  }

  if (toClear.length > 0) {
    await prisma.taskCoordinator.deleteMany({
      where: { taskId: { in: toClear } }
    });
  }
}

export async function ensureGovernanceBootstrap(loginAlias: string) {
  if (loginAlias !== "Bestuur") {
    const placeholder = await prisma.user.findUnique({
      where: { alias: "Bestuur" },
      select: { alias: true, email: true, isActive: true }
    });
    if (placeholder && !placeholder.email && placeholder.isActive) {
      await prisma.user.update({
        where: { alias: "Bestuur" },
        data: { isActive: false }
      });
    }
  }

  await normalizeInheritedOwners();
}
