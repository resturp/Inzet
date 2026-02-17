import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership, resolveEffectiveCoordinatorAliases } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { resolveOwnCoordinatorAliasesAfterRelease } from "@/lib/rules";

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
      { error: "Alleen huidige coordinatoren kunnen taak beschikbaar stellen" },
      { status: 403 }
    );
  }

  const [currentEffectiveCoordinatorAliases, parentEffectiveCoordinatorAliases] = await Promise.all([
    resolveEffectiveCoordinatorAliases(task.id),
    task.parentId ? resolveEffectiveCoordinatorAliases(task.parentId) : Promise.resolve([])
  ]);

  const releaseResolution = resolveOwnCoordinatorAliasesAfterRelease({
    actorAlias: sessionUser.alias,
    currentEffectiveCoordinatorAliases,
    parentEffectiveCoordinatorAliases
  });

  if (releaseResolution.error !== null) {
    return NextResponse.json({ error: releaseResolution.error }, { status: 409 });
  }
  const nextOwnCoordinatorAliases = releaseResolution.ownCoordinatorAliases;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.BESCHIKBAAR }
    });

    await tx.taskCoordinator.deleteMany({
      where: { taskId: task.id }
    });

    if (nextOwnCoordinatorAliases.length > 0) {
      await tx.taskCoordinator.createMany({
        data: nextOwnCoordinatorAliases.map((userAlias) => ({
          taskId: task.id,
          userAlias
        }))
      });
    }

    return tx.task.findUnique({ where: { id: task.id } });
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_RELEASED",
    entityType: "Task",
    entityId: task.id,
    payload: {
      removedCoordinatorAlias: sessionUser.alias,
      ownCoordinatorAliasesAfter: nextOwnCoordinatorAliases
    }
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
