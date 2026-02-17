import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const moveSchema = z.object({
  targetParentId: z.string().trim().min(1)
});

async function wouldCreateCycle(taskId: string, targetParentId: string): Promise<boolean> {
  if (taskId === targetParentId) {
    return true;
  }

  let current = await prisma.task.findUnique({
    where: { id: targetParentId },
    select: { id: true, parentId: true }
  });

  while (current) {
    if (current.id === taskId) {
      return true;
    }
    if (!current.parentId) {
      return false;
    }
    current = await prisma.task.findUnique({
      where: { id: current.parentId },
      select: { id: true, parentId: true }
    });
  }

  return false;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = moveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const [task, targetParent] = await Promise.all([
    prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        parentId: true,
        teamName: true,
        title: true
      }
    }),
    prisma.task.findUnique({
      where: { id: parsed.data.targetParentId },
      select: {
        id: true,
        teamName: true,
        title: true
      }
    })
  ]);

  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }
  if (!targetParent) {
    return NextResponse.json({ error: "Doel-parent niet gevonden" }, { status: 404 });
  }
  if (!task.parentId) {
    return NextResponse.json(
      { error: "Alleen subtaken kunnen worden verplaatst" },
      { status: 409 }
    );
  }

  const [canManageSourceParent, canManageTarget] = await Promise.all([
    canManageTaskByOwnership(sessionUser.alias, task.parentId),
    canManageTaskByOwnership(sessionUser.alias, targetParent.id)
  ]);
  if (!canManageSourceParent) {
    return NextResponse.json(
      { error: "Geen rechten om deze subtaak te verplaatsen" },
      { status: 403 }
    );
  }
  if (!canManageTarget) {
    return NextResponse.json(
      { error: "Subtaak kan alleen naar een parent waarop je beheersrechten hebt worden verplaatst" },
      { status: 403 }
    );
  }

  if (targetParent.teamName !== null && targetParent.teamName !== task.teamName) {
    return NextResponse.json(
      { error: "Taak kan alleen naar een parent met hetzelfde team of zonder team worden verplaatst" },
      { status: 409 }
    );
  }

  if (await wouldCreateCycle(task.id, targetParent.id)) {
    return NextResponse.json({ error: "Deze verplaatsing veroorzaakt een cycle" }, { status: 409 });
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { parentId: targetParent.id }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_MOVED",
    entityType: "Task",
    entityId: task.id,
    payload: {
      fromParentId: task.parentId,
      toParentId: targetParent.id,
      taskTitle: task.title,
      targetParentTitle: targetParent.title
    }
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
