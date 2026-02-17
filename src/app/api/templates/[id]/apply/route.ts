import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  allocatePointsFromParent,
  parseStoredPoints,
  pointsToStorage,
  remainingOwnPoints,
  sumStoredPoints
} from "@/lib/task-points";

const applyTemplateSchema = z.object({
  teamName: z.string().trim().min(2),
  parentTaskId: z.string().trim().optional(),
  date: z.string().datetime().optional()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const parsed = applyTemplateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const { id } = await context.params;
  const template = await prisma.taskTemplate.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: "Sjabloon niet gevonden" }, { status: 404 });
  }

  let parentTaskId = parsed.data.parentTaskId;
  if (!parentTaskId) {
    const root = await prisma.task.findFirst({
      where: { title: "Besturen vereniging", parentId: null }
    });
    if (!root) {
      return NextResponse.json({ error: "Root-taak ontbreekt" }, { status: 409 });
    }
    parentTaskId = root.id;
  }

  const parentTask = await prisma.task.findUnique({
    where: { id: parentTaskId },
    select: { id: true, points: true }
  });
  if (!parentTask) {
    return NextResponse.json({ error: "Parent-taak niet gevonden" }, { status: 404 });
  }

  const canCreateUnderParent = await canManageTaskByOwnership(
    sessionUser.alias,
    parentTask.id
  );
  if (!canCreateUnderParent) {
    return NextResponse.json(
      { error: "Geen rechten om onder deze taak sjabloon toe te passen" },
      { status: 403 }
    );
  }

  const baseDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
  const endTime = new Date(baseDate.getTime() + 2 * 60 * 60 * 1000);

  const childTemplates = await prisma.taskTemplate.findMany({
    where: { parentTemplateId: template.id },
    orderBy: { title: "asc" }
  });

  const requestedRootPoints = 100;
  const parentDirectSubtasks = await prisma.task.findMany({
    where: { parentId: parentTask.id },
    select: { points: true }
  });
  const parentAvailablePoints = remainingOwnPoints({
    ownPoints: parseStoredPoints(parentTask.points),
    issuedToDirectSubtasks: sumStoredPoints(parentDirectSubtasks.map((subtask) => subtask.points))
  });
  const rootAllocation = allocatePointsFromParent({
    availablePoints: parentAvailablePoints,
    requestedPoints: requestedRootPoints
  });

  const childDefaultPoints = childTemplates.map((child) =>
    parseStoredPoints(child.defaultPoints?.toString() ?? "10")
  );
  const totalChildDefaultPoints = childDefaultPoints.reduce((sum, points) => sum + points, 0);
  const zeroSubtree = rootAllocation.zeroed || totalChildDefaultPoints > requestedRootPoints;

  const teamCoordinatorTask = await prisma.$transaction(async (tx) => {
    const coordinatorTask = await tx.task.create({
      data: {
        title: `Coachen ${parsed.data.teamName}`,
        description: `Coordinatietaak voor team ${parsed.data.teamName}`,
        teamName: parsed.data.teamName,
        parentId: parentTask.id,
        points: zeroSubtree ? "0" : pointsToStorage(requestedRootPoints),
        date: baseDate,
        endTime,
        templateId: template.id,
        status: TaskStatus.TOEGEWEZEN
      }
    });

    const subtasks = [];
    for (let index = 0; index < childTemplates.length; index += 1) {
      const child = childTemplates[index];
      const childPoints = childDefaultPoints[index] ?? 0;
      const created = await tx.task.create({
        data: {
          title: child.title,
          description: child.description,
          teamName: parsed.data.teamName,
          parentId: coordinatorTask.id,
          points: zeroSubtree ? "0" : pointsToStorage(childPoints),
          date: baseDate,
          endTime,
          templateId: child.id,
          status: TaskStatus.BESCHIKBAAR
        }
      });
      subtasks.push(created);
    }

    return {
      coordinatorTask,
      subtasks
    };
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TEMPLATE_APPLIED",
    entityType: "TaskTemplate",
    entityId: template.id,
    payload: {
      teamName: parsed.data.teamName,
      parentTaskId: parentTask.id,
      createdTaskId: teamCoordinatorTask.coordinatorTask.id,
      createdSubtasks: teamCoordinatorTask.subtasks.map((item) => item.id),
      pointsZeroed: zeroSubtree
    }
  });

  return NextResponse.json(
    {
      data: {
        createdCoordinatorTaskId: teamCoordinatorTask.coordinatorTask.id,
        createdSubtaskCount: teamCoordinatorTask.subtasks.length,
        pointsZeroed: zeroSubtree
      }
    },
    { status: 201 }
  );
}
