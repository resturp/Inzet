import { OpenTaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { resolveEffectiveCoordinatorAliases } from "@/lib/authorization";
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

  const effectiveCoordinatorAliases = await resolveEffectiveCoordinatorAliases(openTask.taskId);
  const allowed = canActorDecideProposal({
    proposerAlias: openTask.proposerAlias,
    proposedAlias: openTask.proposedAlias,
    actorAlias: sessionUser.alias,
    effectiveCoordinatorAliases
  });
  if (!allowed) {
    return NextResponse.json({ error: "Geen rechten om voorstel af te wijzen" }, { status: 403 });
  }

  await prisma.openTask.update({
    where: { id: openTask.id },
    data: { status: OpenTaskStatus.AFGEWEZEN }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "OPEN_TASK_REJECTED",
    entityType: "OpenTask",
    entityId: openTask.id
  });

  return NextResponse.json({ message: "Voorstel afgewezen" }, { status: 200 });
}
