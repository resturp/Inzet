import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

async function hasCompletedAncestor(taskId: string): Promise<boolean> {
  const visited = new Set<string>([taskId]);
  let current = await prisma.task.findUnique({
    where: { id: taskId },
    select: { parentId: true }
  });

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

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await context.params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const canManage = await canManageTaskByOwnership(sessionUser.alias, task.id);
  if (!canManage) {
    return NextResponse.json(
      { error: "Alleen beheerders/coordinatoren kunnen taak op toegewezen zetten" },
      { status: 403 }
    );
  }

  if (task.status !== TaskStatus.BESCHIKBAAR) {
    return NextResponse.json(
      { error: "Alleen beschikbare taken kunnen op toegewezen worden gezet." },
      { status: 409 }
    );
  }

  if (await hasCompletedAncestor(task.id)) {
    return NextResponse.json(
      { error: "Deze taak staat vast omdat een parent-taak gereed is gemeld." },
      { status: 409 }
    );
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: TaskStatus.TOEGEWEZEN }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_MARKED_ASSIGNED",
    entityType: "Task",
    entityId: task.id
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
