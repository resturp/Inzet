import { OpenTaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/api-session";
import { resolveEffectiveCoordinatorAlias } from "@/lib/authorization";
import { canActorDecideProposal } from "@/lib/rules";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const openTasks = await prisma.openTask.findMany({
    where: { status: OpenTaskStatus.OPEN },
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
  const effectiveCoordinatorByTaskId = new Map(
    await Promise.all(
      taskIds.map(async (taskId) => [taskId, await resolveEffectiveCoordinatorAlias(taskId)] as const)
    )
  );

  const visible = openTasks
    .map((item) => {
      const effectiveCoordinatorAlias = effectiveCoordinatorByTaskId.get(item.taskId) ?? null;
      const canDecide = item.proposedAlias
        ? canActorDecideProposal({
            proposerAlias: item.proposerAlias,
            proposedAlias: item.proposedAlias,
            actorAlias: sessionUser.alias,
            effectiveCoordinatorAlias: effectiveCoordinatorAlias ?? ""
          })
        : false;

      const isRelevant =
        canDecide ||
        item.proposerAlias === sessionUser.alias ||
        item.proposedAlias === sessionUser.alias ||
        effectiveCoordinatorAlias === sessionUser.alias;

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
        canDecide,
        createdAt: item.createdAt
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return NextResponse.json({ data: visible }, { status: 200 });
}
