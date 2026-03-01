import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canEditTaskCoordinatorsByOrganization, canManageTaskByOwnership } from "@/lib/authorization";
import { notifyTaskChangedForEffectiveCoordinators } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { sanitizeNullableText, sanitizeNullableTrimmedText, sanitizeTrimmedText } from "@/lib/sanitize";
import { pointsToStorage } from "@/lib/task-points";

const patchTaskSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().min(2).optional(),
  longDescription: z.string().max(20000).nullable().optional(),
  teamName: z.string().trim().max(100).nullable().optional(),
  coordinationType: z.enum(["DELEGEREN", "ORGANISEREN"]).nullable().optional(),
  coordinatorAliases: z.array(z.string().trim().min(1)).optional(),
  points: z.number().finite().int().nonnegative().optional(),
  date: z.string().datetime().optional(),
  startTime: z.string().datetime().nullable().optional(),
  endTime: z.string().datetime().optional(),
  location: z.string().trim().nullable().optional()
});

async function collectSubtreeTaskIds(rootTaskId: string): Promise<string[]> {
  const ids = [rootTaskId];
  let frontier = [rootTaskId];

  while (frontier.length > 0) {
    const children = await prisma.task.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true }
    });
    frontier = children.map((child) => child.id);
    ids.push(...frontier);
  }

  return ids;
}

async function hasCompletedAncestor(taskId: string): Promise<boolean> {
  let current = await prisma.task.findUnique({
    where: { id: taskId },
    select: { parentId: true }
  });
  const visited = new Set<string>([taskId]);

  while (current?.parentId) {
    const parentId = current.parentId;
    if (visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    const parent = await prisma.task.findUnique({
      where: { id: parentId },
      select: { id: true, parentId: true, status: true }
    });
    if (!parent) {
      break;
    }
    if (parent.status === TaskStatus.GEREED) {
      return true;
    }
    current = { parentId: parent.parentId };
  }

  return false;
}

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = patchTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const sanitizedTitle =
    parsed.data.title === undefined ? undefined : sanitizeTrimmedText(parsed.data.title);
  const sanitizedDescription =
    parsed.data.description === undefined ? undefined : sanitizeTrimmedText(parsed.data.description);
  if (sanitizedTitle !== undefined && sanitizedTitle.length < 2) {
    return NextResponse.json({ error: "Titel moet minimaal 2 tekens bevatten." }, { status: 400 });
  }
  if (sanitizedDescription !== undefined && sanitizedDescription.length < 2) {
    return NextResponse.json({ error: "Beschrijving moet minimaal 2 tekens bevatten." }, { status: 400 });
  }
  const sanitizedLongDescription = sanitizeNullableText(parsed.data.longDescription);
  const sanitizedTeamName = sanitizeNullableTrimmedText(parsed.data.teamName);
  const sanitizedLocation = sanitizeNullableTrimmedText(parsed.data.location);

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }
  if (task.status === TaskStatus.GEREED) {
    return NextResponse.json(
      { error: "Gereed gemelde taken staan vast. Zet de taak eerst op onvoltooid." },
      { status: 409 }
    );
  }
  if (await hasCompletedAncestor(task.id)) {
    return NextResponse.json(
      { error: "Deze taak staat vast omdat een parent-taak gereed is gemeld." },
      { status: 409 }
    );
  }

  const canEditTask = await canManageTaskByOwnership(sessionUser.alias, task.id);
  const canEditCoordinatorsByOrganization = await canEditTaskCoordinatorsByOrganization(
    sessionUser.alias,
    task.id
  );
  const hasCoordinatorUpdate = parsed.data.coordinatorAliases !== undefined;
  const hasPointsUpdate = parsed.data.points !== undefined;
  const hasBaseUpdates =
    parsed.data.title !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.longDescription !== undefined ||
    parsed.data.teamName !== undefined ||
    parsed.data.coordinationType !== undefined ||
    parsed.data.date !== undefined ||
    parsed.data.startTime !== undefined ||
    parsed.data.endTime !== undefined ||
    parsed.data.location !== undefined;

  let canManageParent = false;
  if (task.parentId && hasPointsUpdate) {
    canManageParent = await canManageTaskByOwnership(sessionUser.alias, task.parentId);
  }

  if (!canEditTask) {
    const mayOnlyUpdateSubtaskPoints = Boolean(
      task.parentId && hasPointsUpdate && !hasBaseUpdates && !hasCoordinatorUpdate
    );
    const mayOnlyUpdateCoordinators = Boolean(
      hasCoordinatorUpdate && !hasPointsUpdate && !hasBaseUpdates && canEditCoordinatorsByOrganization
    );
    if (!mayOnlyUpdateSubtaskPoints && !mayOnlyUpdateCoordinators) {
      return NextResponse.json({ error: "Geen rechten op deze taak" }, { status: 403 });
    }
    if (mayOnlyUpdateSubtaskPoints && !canManageParent) {
      return NextResponse.json({ error: "Geen rechten op deze taak" }, { status: 403 });
    }
  }

  if (task.parentId && hasPointsUpdate && !canManageParent) {
    return NextResponse.json(
      { error: "Punten van een subtaak kunnen alleen via de parent-taak worden aangepast" },
      { status: 403 }
    );
  }

  let coordinatorAliases: string[] | undefined = undefined;
  if (hasCoordinatorUpdate) {
    coordinatorAliases = uniqueSortedAliases(
      (parsed.data.coordinatorAliases ?? []).map((alias) => alias.trim()).filter((alias) => alias.length > 0)
    );

    const activeUsers = await prisma.user.findMany({
      where: { alias: { in: coordinatorAliases }, isActive: true },
      select: { alias: true }
    });
    const activeAliasSet = new Set(activeUsers.map((user) => user.alias));
    const unknownOrInactive = coordinatorAliases.filter((alias) => !activeAliasSet.has(alias));
    if (unknownOrInactive.length > 0) {
      return NextResponse.json(
        { error: `Onbekende of inactieve coordinator(en): ${unknownOrInactive.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const baseUpdateData = {
    title: sanitizedTitle,
    description: sanitizedDescription,
    longDescription: sanitizedLongDescription,
    teamName: sanitizedTeamName,
    coordinationType: parsed.data.coordinationType,
    date: parsed.data.date ? new Date(parsed.data.date) : undefined,
    startTime:
      parsed.data.startTime === undefined
        ? undefined
        : parsed.data.startTime
          ? new Date(parsed.data.startTime)
          : null,
    endTime: parsed.data.endTime ? new Date(parsed.data.endTime) : undefined,
    location: sanitizedLocation
  };

  const updatedTask = await prisma.$transaction(async (tx) => {
    if (hasCoordinatorUpdate) {
      await tx.taskCoordinator.deleteMany({
        where: { taskId: task.id }
      });
      if ((coordinatorAliases ?? []).length > 0) {
        await tx.taskCoordinator.createMany({
          data: (coordinatorAliases ?? []).map((userAlias) => ({
            taskId: task.id,
            userAlias
          }))
        });
      }
    }

    return tx.task.update({
      where: { id },
      data:
        canEditTask || !hasPointsUpdate
          ? {
              ...baseUpdateData,
              points: parsed.data.points === undefined ? undefined : pointsToStorage(parsed.data.points)
            }
          : {
              points: pointsToStorage(parsed.data.points!)
            }
    });
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_UPDATED",
    entityType: "Task",
    entityId: updatedTask.id,
    payload:
      hasCoordinatorUpdate
        ? {
            coordinatorAliasesAfter: coordinatorAliases ?? []
          }
        : undefined
  });

  const changedParts: string[] = [];
  if (parsed.data.title !== undefined || parsed.data.description !== undefined) {
    changedParts.push("titel/beschrijving");
  }
  if (parsed.data.longDescription !== undefined) {
    changedParts.push("lange beschrijving");
  }
  if (parsed.data.teamName !== undefined) {
    changedParts.push("team");
  }
  if (parsed.data.coordinationType !== undefined || parsed.data.coordinatorAliases !== undefined) {
    changedParts.push("coordinatoren/werkwijze");
  }
  if (parsed.data.points !== undefined) {
    changedParts.push("punten");
  }
  if (
    parsed.data.date !== undefined ||
    parsed.data.startTime !== undefined ||
    parsed.data.endTime !== undefined
  ) {
    changedParts.push("planning");
  }
  if (parsed.data.location !== undefined) {
    changedParts.push("locatie");
  }

  try {
    await notifyTaskChangedForEffectiveCoordinators({
      taskId: updatedTask.id,
      taskTitle: updatedTask.title,
      actorAlias: sessionUser.alias,
      summary:
        changedParts.length > 0
          ? `Aangepast: ${Array.from(new Set(changedParts)).join(", ")}.`
          : undefined
    });
  } catch (error) {
    console.error("Failed to notify task coordinators about changes", {
      taskId: updatedTask.id,
      error
    });
  }

  return NextResponse.json({ data: updatedTask }, { status: 200 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await context.params;
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      parentId: true,
      status: true
    }
  });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }
  if (task.status === TaskStatus.GEREED) {
    return NextResponse.json(
      { error: "Gereed gemelde taken staan vast. Zet de taak eerst op onvoltooid." },
      { status: 409 }
    );
  }
  if (await hasCompletedAncestor(task.id)) {
    return NextResponse.json(
      { error: "Deze taak staat vast omdat een parent-taak gereed is gemeld." },
      { status: 409 }
    );
  }
  if (!task.parentId) {
    const canManageRootTask = await canManageTaskByOwnership(sessionUser.alias, task.id);
    if (!canManageRootTask) {
      return NextResponse.json(
        { error: "Geen rechten om deze root-taak te verwijderen" },
        { status: 403 }
      );
    }
  } else {
    const canManageParent = await canManageTaskByOwnership(sessionUser.alias, task.parentId);
    if (!canManageParent) {
      return NextResponse.json(
        { error: "Geen rechten om deze subtaak te verwijderen" },
        { status: 403 }
      );
    }
  }

  const subtreeTaskIds = await collectSubtreeTaskIds(task.id);
  const completedTaskInSubtree = await prisma.task.findFirst({
    where: {
      id: { in: subtreeTaskIds },
      status: TaskStatus.GEREED
    },
    select: {
      id: true,
      title: true
    }
  });
  if (completedTaskInSubtree) {
    return NextResponse.json(
      {
        error:
          "Verwijderen is geblokkeerd: in deze tak zit een gereed gemelde taak. Zet die eerst op onvoltooid."
      },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.openTask.deleteMany({
      where: { taskId: { in: subtreeTaskIds } }
    });
    await tx.task.deleteMany({
      where: { id: { in: subtreeTaskIds } }
    });
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_SUBTREE_DELETED",
    entityType: "Task",
    entityId: task.id,
    payload: {
      rootTaskTitle: task.title,
      deletedCount: subtreeTaskIds.length
    }
  });

  return NextResponse.json(
    {
      data: {
        deletedRootTaskId: task.id,
        deletedCount: subtreeTaskIds.length
      }
    },
    { status: 200 }
  );
}
