import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canReadTaskByOwnership } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

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
    select: { id: true }
  });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const canRead = await canReadTaskByOwnership(sessionUser.alias, task.id);
  if (!canRead) {
    return NextResponse.json({ error: "Geen toegang tot deze taak" }, { status: 403 });
  }

  await prisma.taskSubscription.createMany({
    data: [
      {
        taskId: task.id,
        userAlias: sessionUser.alias
      }
    ],
    skipDuplicates: true
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_SUBSCRIPTION_ENABLED",
    entityType: "Task",
    entityId: task.id
  });

  return NextResponse.json(
    {
      data: {
        taskId: task.id,
        subscribed: true
      }
    },
    { status: 200 }
  );
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
    select: { id: true }
  });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const removed = await prisma.taskSubscription.deleteMany({
    where: {
      taskId: task.id,
      userAlias: sessionUser.alias
    }
  });

  if (removed.count > 0) {
    await writeAuditLog({
      actorAlias: sessionUser.alias,
      actionType: "TASK_SUBSCRIPTION_DISABLED",
      entityType: "Task",
      entityId: task.id
    });
  }

  return NextResponse.json(
    {
      data: {
        taskId: task.id,
        subscribed: false
      }
    },
    { status: 200 }
  );
}
