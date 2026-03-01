import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { notifyTaskChangedForEffectiveCoordinators } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

type SnapshotTaskState = {
  id: string;
  status: TaskStatus;
  endTime: string;
};

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === TaskStatus.BESCHIKBAAR || value === TaskStatus.TOEGEWEZEN || value === TaskStatus.GEREED;
}

function parseSnapshotTasks(value: unknown): SnapshotTaskState[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const maybeTasks = (value as { tasks?: unknown }).tasks;
  if (!Array.isArray(maybeTasks)) {
    return [];
  }
  const parsed: SnapshotTaskState[] = [];
  for (const item of maybeTasks) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const id = (item as { id?: unknown }).id;
    const status = (item as { status?: unknown }).status;
    const endTime = (item as { endTime?: unknown }).endTime;
    if (typeof id !== "string" || !isTaskStatus(status) || typeof endTime !== "string") {
      continue;
    }
    const parsedEndTime = new Date(endTime);
    if (!Number.isFinite(parsedEndTime.getTime())) {
      continue;
    }
    parsed.push({ id, status, endTime });
  }
  return parsed;
}

export async function POST(
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
      status: true,
      endTime: true,
      parentId: true
    }
  });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const canManage = await canManageTaskByOwnership(sessionUser.alias, task.id);
  if (!canManage) {
    return NextResponse.json({ error: "Geen rechten om deze taak op onvoltooid te zetten" }, { status: 403 });
  }
  if (task.status !== TaskStatus.GEREED) {
    return NextResponse.json(
      { error: "Alleen gereed gemelde taken kunnen op onvoltooid worden gezet" },
      { status: 409 }
    );
  }

  if (task.parentId) {
    const parentTask = await prisma.task.findUnique({
      where: { id: task.parentId },
      select: { id: true, status: true }
    });
    if (parentTask?.status === TaskStatus.GEREED) {
      return NextResponse.json(
        {
          error:
            "Deze taak kan niet op onvoltooid worden gezet zolang de parent-taak gereed is."
        },
        { status: 409 }
      );
    }
  }

  const now = new Date();
  const latestSnapshot = await prisma.taskCompletionSnapshot.findFirst({
    where: {
      rootTaskId: task.id,
      restoredAt: null
    },
    orderBy: {
      completedAt: "desc"
    },
    select: {
      id: true,
      snapshotJson: true
    }
  });

  const snapshotTasks = parseSnapshotTasks(latestSnapshot?.snapshotJson);
  const hasSnapshot = snapshotTasks.length > 0 && latestSnapshot !== null;

  const updated = await prisma.$transaction(async (tx) => {
    if (hasSnapshot && latestSnapshot) {
      for (const snapshotTask of snapshotTasks) {
        await tx.task.updateMany({
          where: { id: snapshotTask.id },
          data: {
            status: snapshotTask.status,
            endTime: new Date(snapshotTask.endTime)
          }
        });
      }
      await tx.taskCompletionSnapshot.update({
        where: { id: latestSnapshot.id },
        data: {
          restoredAt: now,
          restoredByAlias: sessionUser.alias
        }
      });
      return tx.task.findUnique({
        where: { id: task.id },
        select: {
          id: true,
          status: true,
          endTime: true
        }
      });
    }

    const fallbackEndTime =
      task.endTime.getTime() > now.getTime()
        ? task.endTime
        : new Date(now.getTime() + 60 * 60 * 1000);
    return tx.task.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.TOEGEWEZEN,
        endTime: fallbackEndTime
      },
      select: {
        id: true,
        status: true,
        endTime: true
      }
    });
  });

  if (!updated) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_UNCOMPLETED",
    entityType: "Task",
    entityId: task.id,
    payload: {
      previousStatus: TaskStatus.GEREED,
      nextStatus: updated.status,
      previousEndTime: task.endTime.toISOString(),
      nextEndTime: updated.endTime.toISOString(),
      restoredFromSnapshot: hasSnapshot
    }
  });

  void notifyTaskChangedForEffectiveCoordinators({
    taskId: task.id,
    taskTitle: task.title,
    actorAlias: sessionUser.alias,
    subject: `Taak op onvoltooid gezet: ${task.title}`,
    notifyActor: true,
    summary: hasSnapshot
      ? "Op onvoltooid gezet (exacte staat hersteld)."
      : `Op onvoltooid gezet. Nieuwe eindtijd: ${updated.endTime.toLocaleString("nl-NL")}.`
  }).catch((error) => {
    console.error("Failed to notify coordinators after task uncomplete", {
      taskId: task.id,
      error
    });
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
