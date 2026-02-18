import { OpenTaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
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
  const openTask = await prisma.openTask.findUnique({
    where: { id }
  });

  if (!openTask || openTask.status !== OpenTaskStatus.AFGEWEZEN) {
    return NextResponse.json({ error: "Afgewezen voorstel niet gevonden" }, { status: 404 });
  }

  if (openTask.proposerAlias !== sessionUser.alias) {
    return NextResponse.json({ error: "Geen rechten om deze melding te sluiten" }, { status: 403 });
  }

  await prisma.openTask.delete({
    where: { id: openTask.id }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "OPEN_TASK_REJECTION_ACKNOWLEDGED",
    entityType: "OpenTask",
    entityId: openTask.id
  });

  return NextResponse.json({ message: "Afwijzing gemarkeerd als gezien" }, { status: 200 });
}
