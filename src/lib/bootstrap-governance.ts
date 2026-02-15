import { TaskStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

async function normalizeInheritedOwners() {
  const tasks = await prisma.task.findMany({
    select: { id: true, parentId: true, ownCoordinatorAlias: true }
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));

  function resolveEffective(taskId: string): string | null {
    const visited = new Set<string>();
    let current = byId.get(taskId);
    while (current) {
      if (visited.has(current.id)) {
        break;
      }
      visited.add(current.id);
      if (current.ownCoordinatorAlias) {
        return current.ownCoordinatorAlias;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return null;
  }

  const toClear: string[] = [];
  for (const task of tasks) {
    if (!task.parentId || !task.ownCoordinatorAlias) {
      continue;
    }
    const parentEffective = resolveEffective(task.parentId);
    if (parentEffective && task.ownCoordinatorAlias === parentEffective) {
      toClear.push(task.id);
    }
  }

  if (toClear.length > 0) {
    await prisma.task.updateMany({
      where: { id: { in: toClear } },
      data: { ownCoordinatorAlias: null }
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
    where: { title: "Besturen vereniging", parentId: null }
  });

  if (!rootTask) {
    rootTask = await prisma.task.create({
      data: {
        title: "Besturen vereniging",
        description: "Root taak voor bestuur",
        ownCoordinatorAlias: bestuur.alias,
        points: "1600",
        date: new Date("2026-01-01T00:00:00.000Z"),
        endTime: new Date("2026-12-31T23:59:59.000Z"),
        templateId: template.id,
        status: TaskStatus.TOEGEWEZEN
      }
    });
  } else {
    const needsCoordinatorTransfer =
      rootTask.ownCoordinatorAlias === "Bestuur" && bestuur.alias !== "Bestuur";
    const needsOwnerRestore = !rootTask.ownCoordinatorAlias;
    const needsStatusFix = rootTask.status !== TaskStatus.TOEGEWEZEN;
    if (needsCoordinatorTransfer || needsOwnerRestore || needsStatusFix) {
      rootTask = await prisma.task.update({
        where: { id: rootTask.id },
        data: {
          ownCoordinatorAlias: needsCoordinatorTransfer || needsOwnerRestore
            ? bestuur.alias
            : rootTask.ownCoordinatorAlias,
          status: TaskStatus.TOEGEWEZEN
        }
      });
    }
  }

  let coachingTask = await prisma.task.findFirst({
    where: {
      title: "Coachen Meiden A2",
      parentId: rootTask.id
    }
  });

  if (!coachingTask) {
    coachingTask = await prisma.task.create({
      data: {
        title: "Coachen Meiden A2",
        description: "Coordinatietaak voor team Meiden A2",
        teamName: "Meiden A2",
        parentId: rootTask.id,
        ownCoordinatorAlias: null,
        points: "100",
        date: new Date("2026-03-01T09:00:00.000Z"),
        endTime: new Date("2026-03-01T12:00:00.000Z"),
        templateId: teamTemplate.id,
        status: TaskStatus.TOEGEWEZEN
      }
    });
  }

  const teamfoto = await prisma.task.findFirst({
    where: {
      title: "Teamfoto maken",
      parentId: coachingTask.id
    }
  });

  if (!teamfoto) {
    const oldRootTeamfoto = await prisma.task.findFirst({
      where: {
        title: "Teamfoto maken",
        parentId: rootTask.id
      }
    });
    if (oldRootTeamfoto) {
      await prisma.task.update({
        where: { id: oldRootTeamfoto.id },
        data: {
          parentId: coachingTask.id,
          teamName: "Meiden A2",
          ownCoordinatorAlias: null,
          status: TaskStatus.BESCHIKBAAR
        }
      });
    } else {
      await prisma.task.create({
      data: {
        title: "Teamfoto maken",
        description: "Maak en verstuur de teamfoto.",
        teamName: "Meiden A2",
        parentId: coachingTask.id,
        ownCoordinatorAlias: null,
        points: "30",
        date: new Date("2026-03-01T09:00:00.000Z"),
        endTime: new Date("2026-03-01T12:00:00.000Z"),
        status: TaskStatus.BESCHIKBAAR
      }
      });
    }
  }

  await normalizeInheritedOwners();
}
