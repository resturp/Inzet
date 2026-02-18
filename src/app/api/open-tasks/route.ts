import { OpenTaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/api-session";
import { resolveEffectiveCoordinatorAliases } from "@/lib/authorization";
import { canActorDecideProposal } from "@/lib/rules";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const openTasks = await prisma.openTask.findMany({
    where: {
      OR: [
        { status: OpenTaskStatus.OPEN },
        {
          status: OpenTaskStatus.AFGEWEZEN,
          proposerAlias: sessionUser.alias
        }
      ]
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          teamName: true,
          status: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  const taskIds = Array.from(new Set(openTasks.map((item) => item.taskId)));
  const effectiveCoordinatorsByTaskId = new Map(
    await Promise.all(
      taskIds.map(async (taskId) => [taskId, await resolveEffectiveCoordinatorAliases(taskId)] as const)
    )
  );

  const visible = openTasks
    .map((item) => {
      const effectiveCoordinatorAliases = effectiveCoordinatorsByTaskId.get(item.taskId) ?? [];
      const canDecide = item.status === OpenTaskStatus.OPEN && item.proposedAlias
        ? canActorDecideProposal({
            proposerAlias: item.proposerAlias,
            proposedAlias: item.proposedAlias,
            actorAlias: sessionUser.alias,
            effectiveCoordinatorAliases
          })
        : false;

      const isRelevant =
        item.status === OpenTaskStatus.AFGEWEZEN
          ? item.proposerAlias === sessionUser.alias
          : canDecide ||
            item.proposerAlias === sessionUser.alias ||
            item.proposedAlias === sessionUser.alias ||
            effectiveCoordinatorAliases.includes(sessionUser.alias);

      if (!isRelevant) {
        return null;
      }

      return {
        id: item.id,
        taskId: item.taskId,
        taskTitle: item.task.title,
        teamName: item.task.teamName,
        proposerAlias: item.proposerAlias,
        proposedAlias: item.proposedAlias,
        status: item.status,
        canDecide,
        createdAt: item.createdAt
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return NextResponse.json({ data: visible }, { status: 200 });
}
