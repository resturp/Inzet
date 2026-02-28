import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { addPrecreatedAlias } from "@/lib/precreated-aliases";
import { notifyTaskProposalDecisionRequired } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { resolveCoordinatorAliasesAfterAccept } from "@/lib/rules";

const NEW_ALIAS_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

const proposeSchema = z.object({
  proposedAlias: z.string().trim().min(1)
});

function pendingBondsnummerForAlias(alias: string): string {
  const safeAlias = alias.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  return `PENDING-${safeAlias || "ALIAS"}`;
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
    prisma.user.findUnique({
      where: { alias: parsed.data.proposedAlias },
      select: {
        alias: true,
        isActive: true,
        email: true,
        passwordHash: true
      }
    })
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
  const proposedAlias = parsed.data.proposedAlias;
  const hasCredentials = Boolean(proposed?.email || proposed?.passwordHash);
  if (!proposed && !NEW_ALIAS_PATTERN.test(proposedAlias)) {
    return NextResponse.json(
      {
        error:
          "Nieuwe alias moet 3-32 tekens zijn en mag alleen letters, cijfers, _ en - bevatten."
      },
      { status: 400 }
    );
  }
  if (proposed && hasCredentials) {
    if (!proposed.isActive) {
      return NextResponse.json(
        { error: "Voorgesteld lid is inactief en kan niet worden toegewezen" },
        { status: 403 }
      );
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

    try {
      await notifyTaskProposalDecisionRequired({
        taskId: task.id,
        taskTitle: task.title,
        proposerAlias: openTask.proposerAlias,
        proposedAlias: openTask.proposedAlias!,
        openTaskId: openTask.id,
        actorAlias: sessionUser.alias
      });
    } catch (error) {
      console.error("Failed to notify decision makers for proposal", {
        openTaskId: openTask.id,
        error
      });
    }

    return NextResponse.json({ data: openTask }, { status: 201 });
  }

  await addPrecreatedAlias(proposedAlias);

  const ownCoordinatorRows = await prisma.taskCoordinator.findMany({
    where: { taskId: task.id },
    select: { userAlias: true }
  });
  const desiredEffectiveCoordinatorAliases = resolveCoordinatorAliasesAfterAccept({
    proposedAlias,
    currentOwnCoordinatorAliases: ownCoordinatorRows.map((row) => row.userAlias)
  });

  try {
    await prisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findUnique({
        where: { alias: proposedAlias },
        select: {
          alias: true,
          isActive: true,
          email: true,
          passwordHash: true
        }
      });

      if (!targetUser) {
        await tx.user.create({
          data: {
            alias: proposedAlias,
            bondsnummer: pendingBondsnummerForAlias(proposedAlias),
            isActive: true
          }
        });
      } else if (targetUser.email || targetUser.passwordHash) {
        if (!targetUser.isActive) {
          throw new Error("ALIAS_INACTIVE");
        }
        throw new Error("ALIAS_ALREADY_CLAIMED");
      } else if (!targetUser.isActive) {
        await tx.user.update({
          where: { alias: proposedAlias },
          data: { isActive: true }
        });
      }

      await tx.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.TOEGEWEZEN }
      });

      await tx.taskCoordinator.deleteMany({
        where: { taskId: task.id }
      });

      if (desiredEffectiveCoordinatorAliases.length > 0) {
        await tx.taskCoordinator.createMany({
          data: desiredEffectiveCoordinatorAliases.map((userAlias) => ({
            taskId: task.id,
            userAlias
          }))
        });
      }

    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALIAS_INACTIVE") {
      return NextResponse.json(
        { error: "Voorgesteld lid is inactief en kan niet worden toegewezen" },
        { status: 403 }
      );
    }
    if (error instanceof Error && error.message === "ALIAS_ALREADY_CLAIMED") {
      return NextResponse.json(
        { error: "Alias is inmiddels geclaimd. Kies opnieuw of probeer nog eens." },
        { status: 409 }
      );
    }
    throw error;
  }

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_PROPOSED_AUTO_ACCEPTED",
    entityType: "Task",
    entityId: task.id,
    payload: {
      proposedAlias,
      effectiveCoordinatorAliasesAfter: desiredEffectiveCoordinatorAliases
    }
  });

  return NextResponse.json(
    {
      data: {
        taskId: task.id,
        proposedAlias,
        autoAccepted: true
      }
    },
    { status: 201 }
  );
}
