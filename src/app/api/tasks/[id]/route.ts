import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { sanitizeNullableText, sanitizeNullableTrimmedText, sanitizeTrimmedText } from "@/lib/sanitize";
import { pointsToStorage } from "@/lib/task-points";

const patchTaskSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().min(2).optional(),
  longDescription: z.string().max(20000).nullable().optional(),
  teamName: z.string().trim().max(100).nullable().optional(),
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

  const canEditTask = await canManageTaskByOwnership(sessionUser.alias, task.id);
  const hasPointsUpdate = parsed.data.points !== undefined;
  const hasOtherUpdates =
    parsed.data.title !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.longDescription !== undefined ||
    parsed.data.teamName !== undefined ||
    parsed.data.date !== undefined ||
    parsed.data.startTime !== undefined ||
    parsed.data.endTime !== undefined ||
    parsed.data.location !== undefined;

  let canManageParent = false;
  if (task.parentId && hasPointsUpdate) {
    canManageParent = await canManageTaskByOwnership(sessionUser.alias, task.parentId);
  }

  if (!canEditTask) {
    const mayOnlyUpdateSubtaskPoints = Boolean(task.parentId && hasPointsUpdate && !hasOtherUpdates);
    if (!mayOnlyUpdateSubtaskPoints || !canManageParent) {
      return NextResponse.json({ error: "Geen rechten op deze taak" }, { status: 403 });
    }
  }

  if (task.parentId && hasPointsUpdate && !canManageParent) {
    return NextResponse.json(
      { error: "Punten van een subtaak kunnen alleen via de parent-taak worden aangepast" },
      { status: 403 }
    );
  }

  const baseUpdateData = {
    title: sanitizedTitle,
    description: sanitizedDescription,
    longDescription: sanitizedLongDescription,
    teamName: sanitizedTeamName,
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

  const updatedTask = await prisma.task.update({
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

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_UPDATED",
    entityType: "Task",
    entityId: updatedTask.id
  });

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
      parentId: true
    }
  });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }
  if (!task.parentId) {
    return NextResponse.json({ error: "Root-taak kan niet worden verwijderd" }, { status: 409 });
  }

  const canManageParent = await canManageTaskByOwnership(sessionUser.alias, task.parentId);
  if (!canManageParent) {
    return NextResponse.json(
      { error: "Geen rechten om deze subtaak te verwijderen" },
      { status: 403 }
    );
  }

  const subtreeTaskIds = await collectSubtreeTaskIds(task.id);

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
