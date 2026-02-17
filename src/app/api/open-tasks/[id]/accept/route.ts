import { OpenTaskStatus, TaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { resolveEffectiveCoordinatorAliases } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { canActorDecideProposal, resolveCoordinatorAliasesAfterAccept } from "@/lib/rules";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await context.params;
  const openTask = await prisma.openTask.findUnique({
    where: { id },
    include: { task: true }
  });
  if (!openTask || openTask.status !== OpenTaskStatus.OPEN) {
    return NextResponse.json({ error: "Open taak niet gevonden" }, { status: 404 });
  }
  if (!openTask.proposedAlias) {
    return NextResponse.json(
      { error: "Deze open taak moet via aanmelding/proposal worden afgehandeld" },
      { status: 400 }
    );
  }
  const proposedAlias = openTask.proposedAlias;

  const effectiveCoordinatorAliases = await resolveEffectiveCoordinatorAliases(openTask.taskId);
  const allowed = canActorDecideProposal({
    proposerAlias: openTask.proposerAlias,
    proposedAlias: openTask.proposedAlias,
    actorAlias: sessionUser.alias,
    effectiveCoordinatorAliases
  });

  if (!allowed) {
    return NextResponse.json({ error: "Geen rechten om voorstel te accepteren" }, { status: 403 });
  }

  const ownCoordinatorRows = await prisma.taskCoordinator.findMany({
    where: { taskId: openTask.taskId },
    select: { userAlias: true }
  });

  const desiredEffectiveCoordinatorAliases = resolveCoordinatorAliasesAfterAccept({
    proposedAlias,
    currentOwnCoordinatorAliases: ownCoordinatorRows.map((row) => row.userAlias)
  });

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: openTask.taskId },
      data: {
        status: TaskStatus.TOEGEWEZEN
      }
    });

    await tx.taskCoordinator.deleteMany({
      where: { taskId: openTask.taskId }
    });

    if (desiredEffectiveCoordinatorAliases.length > 0) {
      await tx.taskCoordinator.createMany({
        data: desiredEffectiveCoordinatorAliases.map((userAlias) => ({
          taskId: openTask.taskId,
          userAlias
        }))
      });
    }

    await tx.user.updateMany({
      where: {
        alias: proposedAlias,
        role: UserRole.LID
      },
      data: {
        role: UserRole.COORDINATOR
      }
    });

    await tx.openTask.delete({ where: { id: openTask.id } });
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "OPEN_TASK_ACCEPTED",
    entityType: "OpenTask",
    entityId: openTask.id,
    payload: {
      taskId: openTask.taskId,
      newCoordinator: proposedAlias,
      effectiveCoordinatorAliasesAfter: desiredEffectiveCoordinatorAliases
    }
  });

  return NextResponse.json({ message: "Voorstel geaccepteerd" }, { status: 200 });
}
