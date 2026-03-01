import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import { canCreateSubtaskByOwnership, canManageTaskByOwnership } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { transferPointsBetweenParents } from "@/lib/task-points";

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
        points: true,
        teamName: true,
        title: true
      }
    }),
    prisma.task.findUnique({
      where: { id: parsed.data.targetParentId },
      select: {
        id: true,
        points: true,
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
  if (task.parentId === targetParent.id) {
    return NextResponse.json(
      { error: "Subtaak staat al onder deze parent" },
      { status: 409 }
    );
  }

  const [canManageSourceParent, canManageTarget, canCreateUnderTargetParent] = await Promise.all([
    canManageTaskByOwnership(sessionUser.alias, task.parentId),
    canManageTaskByOwnership(sessionUser.alias, targetParent.id),
    canCreateSubtaskByOwnership(sessionUser.alias, targetParent.id)
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
  if (!canCreateUnderTargetParent) {
    return NextResponse.json(
      {
        error:
          "Je mag hier geen subtaken maken: toewijzing op deze Organiseren-taak geeft niet automatisch subtaakrechten."
      },
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

  const sourceParent = await prisma.task.findUnique({
    where: { id: task.parentId },
    select: {
      id: true,
      points: true
    }
  });
  if (!sourceParent) {
    return NextResponse.json({ error: "Bron-parent niet gevonden" }, { status: 404 });
  }

  const transferPreview = transferPointsBetweenParents({
    sourceParentPoints: sourceParent.points,
    targetParentPoints: targetParent.points,
    movedTaskPoints: task.points
  });
  if (!transferPreview.transferable) {
    return NextResponse.json(
      { error: "Bron-parent heeft onvoldoende punten om deze taak te verplaatsen" },
      { status: 409 }
    );
  }

  let updated: { id: string; parentId: string | null };
  try {
    updated = await prisma.$transaction(async (tx) => {
      const sourceParentUpdate = await tx.task.updateMany({
        where: {
          id: sourceParent.id,
          points: { gte: task.points }
        },
        data: {
          points: { decrement: task.points }
        }
      });
      if (sourceParentUpdate.count !== 1) {
        throw new Error("SOURCE_PARENT_POINTS_TOO_LOW");
      }

      await tx.task.update({
        where: { id: targetParent.id },
        data: {
          points: { increment: task.points }
        }
      });

      return tx.task.update({
        where: { id: task.id },
        data: { parentId: targetParent.id },
        select: { id: true, parentId: true }
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SOURCE_PARENT_POINTS_TOO_LOW") {
      return NextResponse.json(
        { error: "Bron-parent heeft onvoldoende punten om deze taak te verplaatsen" },
        { status: 409 }
      );
    }
    throw error;
  }

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_MOVED",
    entityType: "Task",
    entityId: task.id,
    payload: {
      fromParentId: task.parentId,
      toParentId: targetParent.id,
      taskTitle: task.title,
      targetParentTitle: targetParent.title,
      movedPoints: task.points,
      fromParentPointsAfter: transferPreview.sourceParentPointsAfter,
      toParentPointsAfter: transferPreview.targetParentPointsAfter
    }
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
