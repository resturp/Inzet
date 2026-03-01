import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import {
  hasTaskPermissionFromMap,
  resolveEffectiveCoordinatorAliasesFromMap,
  resolveEffectiveCoordinationTypeFromMap
} from "@/lib/authorization";
import { notifyTaskProposalDecisionRequired } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

type AccessTaskNode = {
  id: string;
  parentId: string | null;
  coordinationType: "DELEGEREN" | "ORGANISEREN" | null;
  ownCoordinatorAliases: string[];
};

type AccessTaskRow = {
  id: string;
  parentId: string | null;
  coordinationType: "DELEGEREN" | "ORGANISEREN" | null;
  ownCoordinators: Array<{ userAlias: string }>;
} | null;

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

async function buildAccessPathMap(taskId: string): Promise<Map<string, AccessTaskNode>> {
  const byId = new Map<string, AccessTaskNode>();
  const visited = new Set<string>();
  let currentId: string | null = taskId;

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const row: AccessTaskRow = await prisma.task.findUnique({
      where: { id: currentId },
      select: {
        id: true,
        parentId: true,
        coordinationType: true,
        ownCoordinators: {
          select: { userAlias: true }
        }
      }
    });

    if (!row) {
      break;
    }

    byId.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      coordinationType:
        row.coordinationType === "DELEGEREN" || row.coordinationType === "ORGANISEREN"
          ? row.coordinationType
          : null,
      ownCoordinatorAliases: uniqueSortedAliases(row.ownCoordinators.map((item) => item.userAlias))
    });

    currentId = row.parentId;
  }

  return byId;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id } = await context.params;
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      endTime: true
    }
  });

  if (!task) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }
  const accessPathMap = await buildAccessPathMap(task.id);
  const canOpen = hasTaskPermissionFromMap(sessionUser.alias, task.id, "OPEN", accessPathMap);
  if (!canOpen) {
    return NextResponse.json({ error: "Geen recht om deze taak te openen" }, { status: 403 });
  }
  if (task.status !== TaskStatus.BESCHIKBAAR) {
    return NextResponse.json({ error: "Taak is niet beschikbaar voor inschrijving" }, { status: 409 });
  }
  if (task.endTime.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "Taak is afgelopen en kan niet meer worden ingeschreven" },
      { status: 409 }
    );
  }
  const effectiveCoordinationType = resolveEffectiveCoordinationTypeFromMap(task.id, accessPathMap);
  const effectiveCoordinatorAliases = resolveEffectiveCoordinatorAliasesFromMap(task.id, accessPathMap);
  if (effectiveCoordinationType === "ORGANISEREN") {
    const firstChild = await prisma.task.findFirst({
      where: { parentId: task.id },
      select: { id: true }
    });
    if (firstChild) {
      return NextResponse.json(
        { error: "Bij organiseren kan je je alleen op een bladtaak (zonder subtaken) inschrijven" },
        { status: 409 }
      );
    }
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

  void notifyTaskProposalDecisionRequired({
    taskId: openTask.taskId,
    taskTitle: task.title ?? openTask.taskId,
    proposerAlias: openTask.proposerAlias,
    proposedAlias: openTask.proposedAlias ?? openTask.proposerAlias,
    openTaskId: openTask.id,
    effectiveCoordinatorAliases,
    actorAlias: sessionUser.alias
  }).catch((error) => {
    console.error("Failed to notify decision makers for registration proposal", {
      openTaskId: openTask.id,
      error
    });
  });

  return NextResponse.json({ data: openTask }, { status: 201 });
}
