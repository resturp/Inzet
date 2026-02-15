import { TaskStatus } from "@prisma/client";
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
  const task = await prisma.task.findUnique({ where: { id } });

  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }
  if (task.status !== TaskStatus.BESCHIKBAAR) {
    return NextResponse.json({ error: "Taak is niet beschikbaar voor inschrijving" }, { status: 409 });
  }

  let openTask;
  try {
    openTask = await prisma.openTask.create({
      data: {
        taskId: task.id,
        proposerAlias: sessionUser.alias,
        proposedAlias: sessionUser.alias
      }
    });
  } catch {
    return NextResponse.json({ error: "Je hebt al een actieve inschrijving voor deze taak" }, { status: 409 });
  }

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_REGISTERED",
    entityType: "OpenTask",
    entityId: openTask.id
  });

  return NextResponse.json({ data: openTask }, { status: 201 });
}
