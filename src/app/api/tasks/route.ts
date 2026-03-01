import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import {
  canEditTaskCoordinatorsFromMap,
  canCreateSubtaskFromMap,
  canCreateSubtaskByOwnership,
  canManageTaskByOwnership,
  hasTaskPermissionFromMap,
  isRootOwner,
  primaryCoordinatorAlias,
  resolveEffectiveCoordinationTypeFromMap,
  resolveEffectiveCoordinatorAliasesFromMap
} from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { sanitizeNullableText, sanitizeOptionalTrimmedText, sanitizeTrimmedText } from "@/lib/sanitize";
import {
  allocatePointsFromParent,
  parseStoredPoints,
  pointsToStorage,
  remainingOwnPoints,
  sumStoredPoints
} from "@/lib/task-points";
import {
  notifySubtasksCreatedForSubscriptions,
  notifyTaskBecameAvailableForEffectiveCoordinators
} from "@/lib/notifications";

const createTaskSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().min(2),
  longDescription: z.string().max(20000).optional(),
  teamName: z.string().trim().max(100).optional(),
  parentId: z.string().trim().optional(),
  points: z.number().finite().int().nonnegative(),
  date: z.string().datetime(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime(),
  location: z.string().trim().optional(),
  coordinationType: z.enum(["DELEGEREN", "ORGANISEREN"]).nullable().optional()
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
      longDescription: true,
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
      subscriptions: {
        where: { userAlias: sessionUser.alias },
        select: { id: true }
      },
      points: true,
      date: true,
      startTime: true,
      endTime: true,
      location: true,
      status: true,
      coordinationType: true
    }
  });

  const byId = new Map(
    tasks.map((task) => [
      task.id,
      {
        id: task.id,
        parentId: task.parentId,
        coordinationType: task.coordinationType,
        ownCoordinatorAliases: uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias))
      }
    ])
  );

  const tasksWithEffectiveCoordinators = tasks.map((task) => {
    const ownCoordinatorAliases = uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias));
    const coordinatorAliases = resolveEffectiveCoordinatorAliasesFromMap(task.id, byId);
    const effectiveCoordinationType = resolveEffectiveCoordinationTypeFromMap(task.id, byId);
    const canRead = hasTaskPermissionFromMap(sessionUser.alias, task.id, "READ", byId);
    const canOpen = hasTaskPermissionFromMap(sessionUser.alias, task.id, "OPEN", byId);
    const canManage = hasTaskPermissionFromMap(sessionUser.alias, task.id, "MANAGE", byId);
    const canCreateSubtask = canCreateSubtaskFromMap(sessionUser.alias, task.id, byId);
    const canEditCoordinators = canEditTaskCoordinatorsFromMap(sessionUser.alias, task.id, byId);

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      longDescription: task.longDescription,
      teamName: task.teamName,
      parentId: task.parentId,
      parent: task.parent,
      points: task.points,
      date: task.date,
      startTime: task.startTime,
      endTime: task.endTime,
      location: task.location,
      status: task.status,
      coordinationType: effectiveCoordinationType,
      ownCoordinationType: task.coordinationType,
      ownCoordinatorAliases,
      isSubscribed: task.subscriptions.length > 0,
      coordinatorAliases,
      coordinatorAlias: primaryCoordinatorAlias(coordinatorAliases),
      canRead,
      canOpen,
      canManage,
      canCreateSubtask,
      canEditCoordinators
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

  const title = sanitizeTrimmedText(parsed.data.title);
  const description = sanitizeTrimmedText(parsed.data.description);
  if (title.length < 2 || description.length < 2) {
    return NextResponse.json({ error: "Titel en beschrijving zijn verplicht." }, { status: 400 });
  }
  const longDescription = sanitizeNullableText(parsed.data.longDescription) ?? null;
  const teamNameSanitized = sanitizeOptionalTrimmedText(parsed.data.teamName);
  const teamName = teamNameSanitized && teamNameSanitized.length > 0 ? teamNameSanitized : undefined;
  const locationSanitized = sanitizeOptionalTrimmedText(parsed.data.location);
  const location = locationSanitized && locationSanitized.length > 0 ? locationSanitized : undefined;

  let parentTask: { id: string; points: number } | null = null;
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

    const canCreateSubtaskUnderParent = await canCreateSubtaskByOwnership(
      sessionUser.alias,
      parentTask.id
    );
    if (!canCreateSubtaskUnderParent) {
      return NextResponse.json(
        {
          error:
            "Je mag hier geen subtaken maken: toewijzing op deze Organiseren-taak geeft niet automatisch subtaakrechten."
        },
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
  const coordinationType =
    parsed.data.coordinationType === undefined ? null : parsed.data.coordinationType;

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
        title,
        description,
        longDescription,
        teamName,
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
        location,
        status: TaskStatus.BESCHIKBAAR,
        coordinationType
      }
    });
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_CREATED",
    entityType: "Task",
    entityId: task.id,
    payload: { parentId: task.parentId, ownCoordinatorAliases, coordinationType }
  });

  try {
    await Promise.all([
      notifyTaskBecameAvailableForEffectiveCoordinators({
        taskId: task.id,
        taskTitle: task.title,
        actorAlias: sessionUser.alias
      }),
      notifySubtasksCreatedForSubscriptions({
        actorAlias: sessionUser.alias,
        createdTasks: [{ id: task.id, title: task.title, parentId: task.parentId }]
      })
    ]);
  } catch (error) {
    console.error("Failed to send task creation notifications", { taskId: task.id, error });
  }

  return NextResponse.json({ data: task }, { status: 201 });
}
