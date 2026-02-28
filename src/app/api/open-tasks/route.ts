import { OpenTaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/api-session";
import { isBestuurAlias, resolveEffectiveCoordinatorAliasesFromMap } from "@/lib/authorization";
import { canActorDecideProposal } from "@/lib/rules";
import { prisma } from "@/lib/prisma";

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const [openTasks, aliasChangeProposals] = await Promise.all([
    prisma.openTask.findMany({
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
            status: true,
            date: true,
            startTime: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }),
    prisma.aliasChangeProposal.findMany({
      where: {
        OR: [
          { status: OpenTaskStatus.OPEN },
          { status: OpenTaskStatus.AFGEWEZEN, requesterAlias: sessionUser.alias }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 200
    })
  ]);

  const taskIds = Array.from(new Set(openTasks.map((item) => item.taskId)));
  const tasksForAccess = taskIds.length > 0
    ? await prisma.task.findMany({
        select: {
          id: true,
          parentId: true,
          coordinationType: true,
          ownCoordinators: {
            select: { userAlias: true }
          }
        }
      })
    : [];

  const tasksById = new Map(
    tasksForAccess.map((task) => [
      task.id,
      {
        id: task.id,
        parentId: task.parentId,
        coordinationType: task.coordinationType,
        ownCoordinatorAliases: uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias))
      }
    ])
  );

  const effectiveCoordinatorsByTaskId = new Map(
    taskIds.map((taskId) => [taskId, resolveEffectiveCoordinatorAliasesFromMap(taskId, tasksById)] as const)
  );

  const needsBestuurCheck = aliasChangeProposals.some((item) => item.status === OpenTaskStatus.OPEN);
  const sessionIsBestuur = needsBestuurCheck ? await isBestuurAlias(sessionUser.alias) : false;

  const visibleTaskProposals = openTasks
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
        proposalType: "TAAK" as const,
        taskId: item.taskId,
        taskTitle: item.task.title,
        teamName: item.task.teamName,
        taskDate: item.task.date,
        taskStartTime: item.task.startTime,
        proposerAlias: item.proposerAlias,
        proposedAlias: item.proposedAlias,
        currentAlias: null,
        requestedAlias: null,
        status: item.status,
        canDecide,
        createdAt: item.createdAt
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const visibleAliasChangeProposals = aliasChangeProposals
    .map((item) => {
      const canDecide = item.status === OpenTaskStatus.OPEN && sessionIsBestuur;

      const isRelevant =
        item.status === OpenTaskStatus.AFGEWEZEN
          ? item.requesterAlias === sessionUser.alias
          : canDecide || item.requesterAlias === sessionUser.alias;

      if (!isRelevant) {
        return null;
      }

      return {
        id: item.id,
        proposalType: "ALIAS_WIJZIGING" as const,
        taskId: null,
        taskTitle: "Aliaswijziging",
        teamName: null,
        taskDate: null,
        taskStartTime: null,
        proposerAlias: item.requesterAlias,
        proposedAlias: item.requestedAlias,
        currentAlias: item.currentAlias,
        requestedAlias: item.requestedAlias,
        status: item.status,
        canDecide,
        createdAt: item.createdAt
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const visible = [...visibleTaskProposals, ...visibleAliasChangeProposals].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

  return NextResponse.json({ data: visible }, { status: 200 });
}
