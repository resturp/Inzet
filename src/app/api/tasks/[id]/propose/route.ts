import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

const proposeSchema = z.object({
  proposedAlias: z.string().trim().min(1)
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = proposeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  if (sessionUser.alias === parsed.data.proposedAlias) {
    return NextResponse.json(
      { error: "Gebruik register-endpoint voor zelfaanmelding" },
      { status: 400 }
    );
  }

  const [task, proposed] = await Promise.all([
    prisma.task.findUnique({ where: { id } }),
    prisma.user.findUnique({ where: { alias: parsed.data.proposedAlias } })
  ]);

  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }
  const canPropose = await canManageTaskByOwnership(sessionUser.alias, task.id);
  if (!canPropose) {
    return NextResponse.json(
      { error: "Alleen de eigenaar/coordinator van de taak kan een voorstel doen" },
      { status: 403 }
    );
  }
  if (task.status !== TaskStatus.TOEGEWEZEN && task.status !== TaskStatus.BESCHIKBAAR) {
    return NextResponse.json(
      { error: "Alleen beschikbare of toegewezen taken kunnen aan een ander worden voorgesteld" },
      { status: 409 }
    );
  }
  if (!proposed || !proposed.isActive) {
    return NextResponse.json({ error: "Voorgesteld lid ongeldig of inactief" }, { status: 403 });
  }

  const openTask = await prisma.openTask.create({
    data: {
      taskId: task.id,
      proposerAlias: sessionUser.alias,
      proposedAlias: proposed.alias
    }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_PROPOSED",
    entityType: "OpenTask",
    entityId: openTask.id,
    payload: { proposedAlias: proposed.alias }
  });

  return NextResponse.json({ data: openTask }, { status: 201 });
}
