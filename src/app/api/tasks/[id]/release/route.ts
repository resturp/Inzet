import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { resolveEffectiveCoordinatorAlias } from "@/lib/authorization";
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

  const effectiveCoordinatorAlias = await resolveEffectiveCoordinatorAlias(task.id);
  if (effectiveCoordinatorAlias !== sessionUser.alias) {
    return NextResponse.json(
      { error: "Alleen huidige coordinator kan taak beschikbaar stellen" },
      { status: 403 }
    );
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: TaskStatus.BESCHIKBAAR }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_RELEASED",
    entityType: "Task",
    entityId: task.id
  });

  return NextResponse.json({ data: updated }, { status: 200 });
}
