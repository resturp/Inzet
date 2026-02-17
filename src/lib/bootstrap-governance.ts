import { TaskStatus, UserRole } from "@prisma/client";
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
  let bestuur = await prisma.user.findFirst({
    where: { role: UserRole.BESTUUR, isActive: true },
    orderBy: { createdAt: "asc" }
  });

  if (!bestuur) {
    bestuur = await prisma.user.update({
      where: { alias: loginAlias },
      data: { role: UserRole.BESTUUR }
    });
  }

  if (bestuur.alias === "Bestuur" && loginAlias !== "Bestuur") {
    const placeholder = await prisma.user.findUnique({ where: { alias: "Bestuur" } });
    if (placeholder && !placeholder.email) {
      bestuur = await prisma.user.update({
        where: { alias: loginAlias },
        data: { role: UserRole.BESTUUR }
      });
      await prisma.user.update({
        where: { alias: "Bestuur" },
        data: { role: UserRole.LID, isActive: false }
      });
    }
  }

  const template =
    (await prisma.taskTemplate.findFirst({
      where: { title: "Top level Sjabloon", parentTemplateId: null }
    })) ??
    (await prisma.taskTemplate.create({
      data: {
        title: "Top level Sjabloon",
        description: "Root sjabloon voor verenigingstaken"
      }
    }));

  const teamTemplate =
    (await prisma.taskTemplate.findFirst({
      where: { title: "Coachen team", parentTemplateId: template.id }
    })) ??
    (await prisma.taskTemplate.create({
      data: {
        title: "Coachen team",
        description: "Sjabloon voor taken rond coaching van een team.",
        parentTemplateId: template.id,
        defaultPoints: "100"
      }
    }));

  const defaultTeamSubtemplates = [
    { title: "Teamfoto maken", description: "Maak en verstuur de teamfoto.", defaultPoints: "30" },
    { title: "Rijden", description: "Regel en/of uitvoer van vervoer.", defaultPoints: "20" },
    { title: "Wassen", description: "Wasschema beheren en uitvoeren.", defaultPoints: "15" }
  ];
  for (const subtemplate of defaultTeamSubtemplates) {
    const exists = await prisma.taskTemplate.findFirst({
      where: { title: subtemplate.title, parentTemplateId: teamTemplate.id }
    });
    if (!exists) {
      await prisma.taskTemplate.create({
        data: {
          title: subtemplate.title,
          description: subtemplate.description,
          defaultPoints: subtemplate.defaultPoints,
          parentTemplateId: teamTemplate.id
        }
      });
    }
  }

  let rootTask = await prisma.task.findFirst({
    where: { title: "Besturen vereniging", parentId: null },
    include: {
      ownCoordinators: {
        select: { userAlias: true }
      }
    }
  });

  if (!rootTask) {
    rootTask = await prisma.task.create({
      data: {
        title: "Besturen vereniging",
        description: "Root taak voor bestuur",
        ownCoordinators: {
          create: [{ userAlias: bestuur.alias }]
        },
        points: "1600",
        date: new Date("2026-01-01T00:00:00.000Z"),
        endTime: new Date("2026-12-31T23:59:59.000Z"),
        templateId: template.id,
        status: TaskStatus.TOEGEWEZEN
      },
      include: {
        ownCoordinators: {
          select: { userAlias: true }
        }
      }
    });
  } else {
    const rootOwnAliases = uniqueSortedAliases(rootTask.ownCoordinators.map((item) => item.userAlias));
    const needsCoordinatorTransfer =
      rootOwnAliases.length === 1 && rootOwnAliases[0] === "Bestuur" && bestuur.alias !== "Bestuur";
    const needsOwnerRestore = rootOwnAliases.length === 0;
    const needsStatusFix = rootTask.status !== TaskStatus.TOEGEWEZEN;

    if (needsStatusFix) {
      rootTask = await prisma.task.update({
        where: { id: rootTask.id },
        data: {
          status: TaskStatus.TOEGEWEZEN
        },
        include: {
          ownCoordinators: {
            select: { userAlias: true }
          }
        }
      });
    }

    if (needsCoordinatorTransfer) {
      await prisma.taskCoordinator.deleteMany({
        where: {
          taskId: rootTask.id,
          userAlias: "Bestuur"
        }
      });
      await prisma.taskCoordinator.upsert({
        where: {
          taskId_userAlias: {
            taskId: rootTask.id,
            userAlias: bestuur.alias
          }
        },
        update: {},
        create: {
          taskId: rootTask.id,
          userAlias: bestuur.alias
        }
      });
    } else if (needsOwnerRestore) {
      await prisma.taskCoordinator.upsert({
        where: {
          taskId_userAlias: {
            taskId: rootTask.id,
            userAlias: bestuur.alias
          }
        },
        update: {},
        create: {
          taskId: rootTask.id,
          userAlias: bestuur.alias
        }
      });
    }
  }

  await normalizeInheritedOwners();
}
