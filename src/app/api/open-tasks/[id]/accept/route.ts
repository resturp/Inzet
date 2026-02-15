import { OpenTaskStatus, TaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { resolveEffectiveCoordinatorAlias } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { canActorDecideProposal } from "@/lib/rules";

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

  const effectiveCoordinatorAlias = await resolveEffectiveCoordinatorAlias(openTask.taskId);
  const allowed = canActorDecideProposal({
    proposerAlias: openTask.proposerAlias,
    proposedAlias: openTask.proposedAlias,
    actorAlias: sessionUser.alias,
    effectiveCoordinatorAlias: effectiveCoordinatorAlias ?? ""
  });

  if (!allowed) {
    return NextResponse.json({ error: "Geen rechten om voorstel te accepteren" }, { status: 403 });
  }

  const parentEffectiveCoordinatorAlias = openTask.task.parentId
    ? await resolveEffectiveCoordinatorAlias(openTask.task.parentId)
    : null;
  const nextOwnCoordinatorAlias =
    parentEffectiveCoordinatorAlias && parentEffectiveCoordinatorAlias === openTask.proposedAlias
      ? null
      : openTask.proposedAlias;

  await prisma.$transaction([
    prisma.task.update({
      where: { id: openTask.taskId },
      data: {
        ownCoordinatorAlias: nextOwnCoordinatorAlias,
        status: TaskStatus.TOEGEWEZEN
      }
    }),
    prisma.user.updateMany({
      where: {
        alias: openTask.proposedAlias,
        role: UserRole.LID
      },
      data: {
        role: UserRole.COORDINATOR
      }
    }),
    prisma.openTask.delete({ where: { id: openTask.id } })
  ]);

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "OPEN_TASK_ACCEPTED",
    entityType: "OpenTask",
    entityId: openTask.id,
    payload: { taskId: openTask.taskId, newCoordinator: openTask.proposedAlias }
  });

  return NextResponse.json({ message: "Voorstel geaccepteerd" }, { status: 200 });
}
