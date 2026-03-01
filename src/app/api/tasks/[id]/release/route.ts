import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership, resolveEffectiveCoordinatorAliases } from "@/lib/authorization";
import { notifyTaskBecameAvailableForEffectiveCoordinators } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { resolveOwnCoordinatorAliasesAfterRelease } from "@/lib/rules";

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
      { error: "Alleen huidige coordinatoren kunnen taak beschikbaar stellen" },
      { status: 403 }
    );
  }
  if (task.status === TaskStatus.GEREED || (await hasCompletedAncestor(task.id))) {
    return NextResponse.json(
      { error: "Gereed gemelde taken staan vast. Zet de taak eerst op onvoltooid." },
      { status: 409 }
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

  try {
    await notifyTaskBecameAvailableForEffectiveCoordinators({
      taskId: task.id,
      taskTitle: task.title,
      actorAlias: sessionUser.alias
    });
  } catch (error) {
    console.error("Failed to notify task availability", { taskId: task.id, error });
  }

  return NextResponse.json({ data: updated }, { status: 200 });
}
