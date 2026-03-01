import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { notifyTaskChangedForEffectiveCoordinators } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

type SubtreeTaskRow = {
  id: string;
  title: string;
  parentId: string | null;
  date: Date;
  startTime: Date | null;
  endTime: Date;
  status: TaskStatus;
};

async function collectTaskSubtree(rootTaskId: string): Promise<SubtreeTaskRow[]> {
  const nodes: SubtreeTaskRow[] = [];
  const visited = new Set<string>();
  let frontier = [rootTaskId];

  while (frontier.length > 0) {
    const rows = await prisma.task.findMany({
      where: {
        id: { in: frontier }
      },
      select: {
        id: true,
        title: true,
        parentId: true,
        date: true,
        startTime: true,
        endTime: true,
        status: true
      }
    });

    const freshRows = rows.filter((row) => !visited.has(row.id));
    for (const row of freshRows) {
      visited.add(row.id);
      nodes.push(row);
    }

    if (freshRows.length === 0) {
      break;
    }

    const childRows = await prisma.task.findMany({
      where: {
        parentId: { in: freshRows.map((row) => row.id) }
      },
      select: {
        id: true
      }
    });

    frontier = childRows
      .map((row) => row.id)
      .filter((id) => !visited.has(id));
  }

  return nodes;
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
      endTime: true
    }
  });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const canManage = await canManageTaskByOwnership(sessionUser.alias, task.id);
  if (!canManage) {
    return NextResponse.json({ error: "Geen rechten om deze taak gereed te melden" }, { status: 403 });
  }

  if (task.status !== TaskStatus.TOEGEWEZEN) {
    return NextResponse.json(
      { error: "Alleen toegewezen taken kunnen gereed worden gemeld" },
      { status: 409 }
    );
  }

  const now = new Date();
  if (task.endTime.getTime() <= now.getTime()) {
    return NextResponse.json(
      { error: "Taak eindigt al in het verleden; gereedmelden is niet nodig" },
      { status: 409 }
    );
  }

  const subtree = await collectTaskSubtree(task.id);
  if (!subtree.some((row) => row.id === task.id)) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const firstFutureStart = subtree.find((row) => {
    const startAt = row.startTime ?? row.date;
    return startAt.getTime() > now.getTime();
  });
  if (firstFutureStart) {
    return NextResponse.json(
      {
        error: `Gereedmelden kan pas als alle starttijden in het verleden liggen. Nog niet gestart: ${firstFutureStart.title}`
      },
      { status: 409 }
    );
  }

  const affected = subtree.filter((row) => row.endTime.getTime() > now.getTime());
  if (affected.length === 0) {
    return NextResponse.json(
      { error: "Geen eindtijden hoeven te worden aangepast" },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const row of affected) {
      await tx.task.update({
        where: { id: row.id },
        data: {
          endTime: now,
          status: row.status === TaskStatus.TOEGEWEZEN ? TaskStatus.GEREED : row.status
        }
      });
    }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_COMPLETED",
    entityType: "Task",
    entityId: task.id,
    payload: {
      affectedTaskIds: affected.map((row) => row.id),
      affectedCount: affected.length,
      completedAt: now.toISOString()
    }
  });

  void notifyTaskChangedForEffectiveCoordinators({
    taskId: task.id,
    taskTitle: task.title,
    actorAlias: sessionUser.alias,
    summary: `Gereed gemeld: ${affected.length} taak/taken op eindtijd begrensd tot ${now.toLocaleString("nl-NL")}.`
  }).catch((error) => {
    console.error("Failed to notify coordinators after task completion", {
      taskId: task.id,
      error
    });
  });

  return NextResponse.json(
    {
      data: {
        taskId: task.id,
        affectedCount: affected.length,
        completedAt: now,
        affectedTaskIds: affected.map((row) => row.id)
      }
    },
    { status: 200 }
  );
}
