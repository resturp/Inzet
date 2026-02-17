import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import {
  canManageTaskByOwnership,
  hasTaskPermissionFromMap,
  isRootOwner,
  primaryCoordinatorAlias,
  resolveEffectiveCoordinatorAliasesFromMap
} from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import {
  allocatePointsFromParent,
  parseStoredPoints,
  pointsToStorage,
  remainingOwnPoints,
  sumStoredPoints
} from "@/lib/task-points";

const createTaskSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().min(2),
  teamName: z.string().trim().max(100).optional(),
  parentId: z.string().trim().optional(),
  points: z.number().finite().nonnegative(),
  date: z.string().datetime(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime(),
  location: z.string().trim().optional(),
  templateId: z.string().trim().optional()
});

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

  const tasks = await prisma.task.findMany({
    orderBy: [{ date: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      description: true,
      teamName: true,
      parentId: true,
      parent: {
        select: {
          id: true,
          title: true,
          teamName: true
        }
      },
      ownCoordinators: {
        select: { userAlias: true }
      },
      points: true,
      date: true,
      startTime: true,
      endTime: true,
      location: true,
      status: true
    }
  });

  const byId = new Map(
    tasks.map((task) => [
      task.id,
      {
        id: task.id,
        parentId: task.parentId,
        ownCoordinatorAliases: uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias))
      }
    ])
  );

  const tasksWithEffectiveCoordinators = tasks.map((task) => {
    const ownCoordinatorAliases = uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias));
    const coordinatorAliases = resolveEffectiveCoordinatorAliasesFromMap(task.id, byId);
    const canRead = hasTaskPermissionFromMap(sessionUser.alias, task.id, "READ", byId);
    const canOpen = hasTaskPermissionFromMap(sessionUser.alias, task.id, "OPEN", byId);
    const canManage = hasTaskPermissionFromMap(sessionUser.alias, task.id, "MANAGE", byId);

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      teamName: task.teamName,
      parentId: task.parentId,
      parent: task.parent,
      points: task.points,
      date: task.date,
      startTime: task.startTime,
      endTime: task.endTime,
      location: task.location,
      status: task.status,
      ownCoordinatorAliases,
      coordinatorAliases,
      coordinatorAlias: primaryCoordinatorAlias(coordinatorAliases),
      canRead,
      canOpen,
      canManage
    };
  });

  const ownedTaskIds = new Set(
    tasksWithEffectiveCoordinators
      .filter((task) => task.canManage)
      .map((task) => task.id)
  );

  function isOwnedBranchTask(taskId: string): boolean {
    const visited = new Set<string>();
    let current = byId.get(taskId);
    while (current) {
      if (visited.has(current.id)) {
        break;
      }
      visited.add(current.id);
      if (ownedTaskIds.has(current.id)) {
        return true;
      }
      if (!current.parentId) {
        break;
      }
      current = byId.get(current.parentId);
    }
    return false;
  }

  const readableOrOwnedBranch = tasksWithEffectiveCoordinators.filter(
    (task) => task.canRead || task.canOpen || isOwnedBranchTask(task.id)
  );

  return NextResponse.json({ data: readableOrOwnedBranch }, { status: 200 });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const parsed = createTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  let parentTask: { id: string; points: { toString: () => string } } | null = null;
  if (parsed.data.parentId) {
    parentTask = await prisma.task.findUnique({
      where: { id: parsed.data.parentId },
      select: { id: true, points: true }
    });

    if (!parentTask) {
      return NextResponse.json({ error: "Parent-taak niet gevonden" }, { status: 404 });
    }

    const canCreateUnderParent = await canManageTaskByOwnership(sessionUser.alias, parentTask.id);
    if (!canCreateUnderParent) {
      return NextResponse.json(
        { error: "Alleen de coordinator van de parent-taak mag subtaken maken" },
        { status: 403 }
      );
    }
  }

  if (!parentTask) {
    const allowed = await isRootOwner(sessionUser.alias);
    if (!allowed) {
      return NextResponse.json(
        { error: "Alleen de eigenaar van de root-taak mag root-taken maken" },
        { status: 403 }
      );
    }
  }

  const ownCoordinatorAliases = parentTask ? [] : [sessionUser.alias];

  const task = await prisma.$transaction(async (tx) => {
    let pointsToAssign = parsed.data.points;

    if (parentTask) {
      const directSubtasks = await tx.task.findMany({
        where: { parentId: parentTask.id },
        select: { points: true }
      });
      const parentAvailablePoints = remainingOwnPoints({
        ownPoints: parseStoredPoints(parentTask.points),
        issuedToDirectSubtasks: sumStoredPoints(directSubtasks.map((subtask) => subtask.points))
      });
      const allocation = allocatePointsFromParent({
        availablePoints: parentAvailablePoints,
        requestedPoints: parsed.data.points
      });

      pointsToAssign = allocation.assignedPoints;
    }

    return tx.task.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description,
        teamName: parsed.data.teamName,
        parentId: parsed.data.parentId,
        ownCoordinators:
          ownCoordinatorAliases.length > 0
            ? {
                create: ownCoordinatorAliases.map((userAlias) => ({ userAlias }))
              }
            : undefined,
        points: pointsToStorage(pointsToAssign),
        date: new Date(parsed.data.date),
        startTime: parsed.data.startTime ? new Date(parsed.data.startTime) : null,
        endTime: new Date(parsed.data.endTime),
        location: parsed.data.location,
        templateId: parsed.data.templateId,
        status: TaskStatus.BESCHIKBAAR
      }
    });
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_CREATED",
    entityType: "Task",
    entityId: task.id,
    payload: { parentId: task.parentId, ownCoordinatorAliases }
  });

  return NextResponse.json({ data: task }, { status: 201 });
}
