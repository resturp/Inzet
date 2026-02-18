import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { pointsToStorage } from "@/lib/task-points";

const patchTaskSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().min(2).optional(),
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

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const canEditTask = await canManageTaskByOwnership(sessionUser.alias, task.id);
  const hasPointsUpdate = parsed.data.points !== undefined;
  const hasOtherUpdates =
    parsed.data.title !== undefined ||
    parsed.data.description !== undefined ||
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
    title: parsed.data.title,
    description: parsed.data.description,
    teamName:
      parsed.data.teamName === undefined
        ? undefined
        : parsed.data.teamName
          ? parsed.data.teamName
          : null,
    date: parsed.data.date ? new Date(parsed.data.date) : undefined,
    startTime:
      parsed.data.startTime === undefined
        ? undefined
        : parsed.data.startTime
          ? new Date(parsed.data.startTime)
          : null,
    endTime: parsed.data.endTime ? new Date(parsed.data.endTime) : undefined,
    location:
      parsed.data.location === undefined
        ? undefined
        : parsed.data.location
          ? parsed.data.location
          : null
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
