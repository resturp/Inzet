import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canCreateSubtaskByOwnership, canManageTaskByOwnership } from "@/lib/authorization";
import {
  notifySubtasksCreatedForSubscriptions,
  notifyTaskBecameAvailableForEffectiveCoordinators
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  sanitizeNullableText,
  sanitizeNullableTrimmedText,
  sanitizeTrimmedText
} from "@/lib/sanitize";
import {
  allocatePointsFromParent,
  parseStoredPoints,
  pointsToStorage,
  remainingOwnPoints,
  sumStoredPoints
} from "@/lib/task-points";

const copySchema = z.object({
  targetParentId: z.string().trim().min(1),
  dateTimeHandling: z
    .union([
      z.object({
        mode: z.literal("KEEP")
      }),
      z.object({
        mode: z.literal("SHIFT"),
        amount: z.number().finite().int().positive(),
        unit: z.enum(["hours", "days", "weeks", "months", "years"])
      })
    ])
    .optional(),
  rootOverride: z
    .object({
      title: z.string().trim().min(2).optional(),
      description: z.string().trim().min(2).optional(),
      longDescription: z.string().max(20000).nullable().optional(),
      teamName: z.string().trim().max(100).nullable().optional(),
      coordinationType: z.enum(["DELEGEREN", "ORGANISEREN"]).nullable().optional(),
      points: z.number().finite().int().nonnegative().optional(),
      date: z.string().datetime().optional(),
      startTime: z.string().datetime().nullable().optional(),
      endTime: z.string().datetime().optional(),
      location: z.string().trim().nullable().optional()
    })
    .optional()
});

type TaskNode = {
  id: string;
  title: string;
  description: string;
  longDescription: string | null;
  teamName: string | null;
  parentId: string | null;
  coordinationType: "DELEGEREN" | "ORGANISEREN" | null;
  ownCoordinatorAliases: string[];
  points: number;
  date: Date;
  startTime: Date | null;
  endTime: Date;
  location: string | null;
  status: TaskStatus;
};

type CreatedTaskSummary = {
  id: string;
  title: string;
  parentId: string | null;
  status: TaskStatus;
};

type DateShiftUnit = "hours" | "days" | "weeks" | "months" | "years";
type DateTimeHandling =
  | { mode: "KEEP" }
  | { mode: "SHIFT"; amount: number; unit: DateShiftUnit };

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function coordinatorCreateData(aliases: readonly string[]) {
  if (aliases.length === 0) {
    return undefined;
  }
  return {
    create: aliases.map((userAlias) => ({ userAlias }))
  };
}

function cloneDate(value: Date): Date {
  return new Date(value);
}

function addMonthsClamped(value: Date, months: number): Date {
  const result = cloneDate(value);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const monthDays = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, monthDays));
  return result;
}

function shiftDate(value: Date, amount: number, unit: DateShiftUnit): Date {
  switch (unit) {
    case "hours":
      return new Date(value.getTime() + amount * 60 * 60 * 1000);
    case "days":
      return new Date(value.getTime() + amount * 24 * 60 * 60 * 1000);
    case "weeks":
      return new Date(value.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
    case "months":
      return addMonthsClamped(value, amount);
    case "years":
      return addMonthsClamped(value, amount * 12);
  }
}

function applyDateTimeHandling(
  date: Date,
  startTime: Date | null,
  endTime: Date,
  handling: DateTimeHandling
): { date: Date; startTime: Date | null; endTime: Date } {
  if (handling.mode === "KEEP") {
    return {
      date: cloneDate(date),
      startTime: startTime ? cloneDate(startTime) : null,
      endTime: cloneDate(endTime)
    };
  }

  return {
    date: shiftDate(date, handling.amount, handling.unit),
    startTime: startTime ? shiftDate(startTime, handling.amount, handling.unit) : null,
    endTime: shiftDate(endTime, handling.amount, handling.unit)
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id: sourceTaskId } = await context.params;
  const parsed = copySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }
  const rootOverride = parsed.data.rootOverride
    ? {
        ...parsed.data.rootOverride,
        title:
          parsed.data.rootOverride.title === undefined
            ? undefined
            : sanitizeTrimmedText(parsed.data.rootOverride.title),
        description:
          parsed.data.rootOverride.description === undefined
            ? undefined
            : sanitizeTrimmedText(parsed.data.rootOverride.description),
        longDescription: sanitizeNullableText(parsed.data.rootOverride.longDescription),
        teamName: sanitizeNullableTrimmedText(parsed.data.rootOverride.teamName),
        location: sanitizeNullableTrimmedText(parsed.data.rootOverride.location)
      }
    : undefined;
  if (rootOverride?.title !== undefined && rootOverride.title.length < 2) {
    return NextResponse.json({ error: "Titel moet minimaal 2 tekens bevatten." }, { status: 400 });
  }
  if (rootOverride?.description !== undefined && rootOverride.description.length < 2) {
    return NextResponse.json(
      { error: "Beschrijving moet minimaal 2 tekens bevatten." },
      { status: 400 }
    );
  }

  const sourceTaskContext = await prisma.task.findUnique({
    where: { id: sourceTaskId },
    select: {
      id: true,
      parentId: true
    }
  });
  if (!sourceTaskContext) {
    return NextResponse.json({ error: "Bron-taak niet gevonden" }, { status: 404 });
  }
  if (!sourceTaskContext.parentId) {
    return NextResponse.json(
      { error: "Alleen subtaken kunnen worden gekopieerd" },
      { status: 409 }
    );
  }

  const [canManageSourceParent, canManageTarget, canCreateUnderTargetParent] = await Promise.all([
    canManageTaskByOwnership(sessionUser.alias, sourceTaskContext.parentId),
    canManageTaskByOwnership(sessionUser.alias, parsed.data.targetParentId),
    canCreateSubtaskByOwnership(sessionUser.alias, parsed.data.targetParentId)
  ]);
  if (!canManageSourceParent || !canManageTarget) {
    return NextResponse.json(
      { error: "Geen rechten om deze subtaak te kopieren" },
      { status: 403 }
    );
  }
  if (!canCreateUnderTargetParent) {
    return NextResponse.json(
      {
        error:
          "Je mag hier geen subtaken maken: toewijzing op deze Organiseren-taak geeft niet automatisch subtaakrechten."
      },
      { status: 403 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [sourceTaskRaw, targetParent] = await Promise.all([
        tx.task.findUnique({
          where: { id: sourceTaskId },
          select: {
            id: true,
            title: true,
            description: true,
            longDescription: true,
            teamName: true,
            parentId: true,
            ownCoordinators: {
              select: { userAlias: true }
            },
            coordinationType: true,
            points: true,
            date: true,
            startTime: true,
            endTime: true,
            location: true,
            status: true
          }
        }),
        tx.task.findUnique({
          where: { id: parsed.data.targetParentId },
          select: { id: true, points: true }
        })
      ]);

      if (!sourceTaskRaw) {
        throw new Error("SOURCE_NOT_FOUND");
      }
      if (!targetParent) {
        throw new Error("TARGET_NOT_FOUND");
      }

      const sourceTask: TaskNode = {
        ...sourceTaskRaw,
        ownCoordinatorAliases: uniqueSortedAliases(
          sourceTaskRaw.ownCoordinators.map((item) => item.userAlias)
        )
      };

      const nodes = new Map<string, TaskNode>([[sourceTask.id, sourceTask]]);
      let frontier = [sourceTask.id];

      while (frontier.length > 0) {
        const children = await tx.task.findMany({
          where: { parentId: { in: frontier } },
          select: {
            id: true,
            title: true,
            description: true,
            longDescription: true,
            teamName: true,
            parentId: true,
            ownCoordinators: {
              select: { userAlias: true }
            },
            coordinationType: true,
            points: true,
            date: true,
            startTime: true,
            endTime: true,
            location: true,
            status: true
          }
        });

        frontier = [];
        for (const child of children) {
          nodes.set(child.id, {
            ...child,
            ownCoordinatorAliases: uniqueSortedAliases(
              child.ownCoordinators.map((item) => item.userAlias)
            )
          });
          frontier.push(child.id);
        }
      }

      const childrenByParent = new Map<string, TaskNode[]>();
      for (const node of nodes.values()) {
        if (!node.parentId || !nodes.has(node.parentId)) {
          continue;
        }
        const siblings = childrenByParent.get(node.parentId);
        if (!siblings) {
          childrenByParent.set(node.parentId, [node]);
          continue;
        }
        siblings.push(node);
      }

      const override = rootOverride;
      const dateTimeHandling: DateTimeHandling = parsed.data.dateTimeHandling ?? {
        mode: "KEEP"
      };
      const createdTasks: CreatedTaskSummary[] = [];
      const requestedRootPoints =
        override?.points !== undefined ? override.points : parseStoredPoints(sourceTask.points);
      const rootDirectChildren = childrenByParent.get(sourceTask.id) ?? [];
      const requestedRootChildPoints = sumStoredPoints(
        rootDirectChildren.map((child) => child.points)
      );
      const targetDirectSubtasks = await tx.task.findMany({
        where: { parentId: targetParent.id },
        select: { points: true }
      });
      const targetAvailablePoints = remainingOwnPoints({
        ownPoints: parseStoredPoints(targetParent.points),
        issuedToDirectSubtasks: sumStoredPoints(
          targetDirectSubtasks.map((subtask) => subtask.points)
        )
      });
      const rootAllocation = allocatePointsFromParent({
        availablePoints: targetAvailablePoints,
        requestedPoints: requestedRootPoints
      });
      const shouldZeroSubtree =
        rootAllocation.zeroed || requestedRootChildPoints > requestedRootPoints;

      const rootDates = applyDateTimeHandling(
        override?.date ? new Date(override.date) : sourceTask.date,
        override?.startTime === undefined
          ? sourceTask.startTime
          : override.startTime
            ? new Date(override.startTime)
            : null,
        override?.endTime ? new Date(override.endTime) : sourceTask.endTime,
        dateTimeHandling
      );

      const rootCopy = await tx.task.create({
        data: {
          title: override?.title ?? sanitizeTrimmedText(sourceTask.title),
          description: override?.description ?? sanitizeTrimmedText(sourceTask.description),
          longDescription:
            override?.longDescription === undefined
              ? (sanitizeNullableText(sourceTask.longDescription) ?? null)
              : override.longDescription,
          teamName:
            override?.teamName === undefined
              ? (sanitizeNullableTrimmedText(sourceTask.teamName) ?? null)
              : override.teamName,
          parentId: targetParent.id,
          coordinationType:
            override?.coordinationType === undefined
              ? sourceTask.coordinationType
              : override.coordinationType,
          ownCoordinators: coordinatorCreateData(sourceTask.ownCoordinatorAliases),
          points: shouldZeroSubtree ? 0 : pointsToStorage(requestedRootPoints),
          date: rootDates.date,
          startTime: rootDates.startTime,
          endTime: rootDates.endTime,
          location:
            override?.location === undefined
              ? (sanitizeNullableTrimmedText(sourceTask.location) ?? null)
              : override.location,
          status: sourceTask.status
        }
      });
      createdTasks.push({
        id: rootCopy.id,
        title: rootCopy.title,
        parentId: rootCopy.parentId,
        status: rootCopy.status
      });

      async function cloneChildren(oldParentId: string, newParentId: string): Promise<void> {
        const children = childrenByParent.get(oldParentId) ?? [];
        for (const child of children) {
          const childDates = applyDateTimeHandling(
            child.date,
            child.startTime,
            child.endTime,
            dateTimeHandling
          );
          const createdChild = await tx.task.create({
            data: {
              title: sanitizeTrimmedText(child.title),
              description: sanitizeTrimmedText(child.description),
              longDescription: sanitizeNullableText(child.longDescription) ?? null,
              teamName: sanitizeNullableTrimmedText(child.teamName) ?? null,
              parentId: newParentId,
              coordinationType: child.coordinationType,
              ownCoordinators: coordinatorCreateData(child.ownCoordinatorAliases),
              points: shouldZeroSubtree ? 0 : child.points,
              date: childDates.date,
              startTime: childDates.startTime,
              endTime: childDates.endTime,
              location: sanitizeNullableTrimmedText(child.location) ?? null,
              status: child.status
            }
          });
          createdTasks.push({
            id: createdChild.id,
            title: createdChild.title,
            parentId: createdChild.parentId,
            status: createdChild.status
          });
          await cloneChildren(child.id, createdChild.id);
        }
      }

      await cloneChildren(sourceTask.id, rootCopy.id);

      return {
        rootId: rootCopy.id,
        createdCount: createdTasks.length,
        pointsZeroed: shouldZeroSubtree,
        createdTasks
      };
    });

    await writeAuditLog({
      actorAlias: sessionUser.alias,
      actionType: "TASK_SUBTREE_COPIED",
      entityType: "Task",
      entityId: sourceTaskId,
      payload: {
        targetParentId: parsed.data.targetParentId,
        dateTimeHandling: parsed.data.dateTimeHandling ?? { mode: "KEEP" },
        newRootId: result.rootId,
        createdCount: result.createdCount
      }
    });

    try {
      await notifySubtasksCreatedForSubscriptions({
        actorAlias: sessionUser.alias,
        createdTasks: result.createdTasks.map((task) => ({
          id: task.id,
          title: task.title,
          parentId: task.parentId
        }))
      });

      const availableTasks = result.createdTasks.filter(
        (task) => task.status === TaskStatus.BESCHIKBAAR
      );
      await Promise.all(
        availableTasks.map((task) =>
          notifyTaskBecameAvailableForEffectiveCoordinators({
            taskId: task.id,
            taskTitle: task.title,
            actorAlias: sessionUser.alias
          })
        )
      );
    } catch (error) {
      console.error("Failed to send notifications for copied task subtree", {
        sourceTaskId,
        error
      });
    }

    return NextResponse.json(
      {
        data: {
          rootId: result.rootId,
          createdCount: result.createdCount,
          pointsZeroed: result.pointsZeroed
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SOURCE_NOT_FOUND") {
      return NextResponse.json({ error: "Bron-taak niet gevonden" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "TARGET_NOT_FOUND") {
      return NextResponse.json({ error: "Doel-parent niet gevonden" }, { status: 404 });
    }
    return NextResponse.json({ error: "Kopieren mislukt" }, { status: 500 });
  }
}
