import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import {
  canManageTaskByOwnership,
  isRootOwner,
  resolveEffectiveCoordinatorAliasFromMap
} from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

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
      ownCoordinatorAlias: true,
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
        ownCoordinatorAlias: task.ownCoordinatorAlias
      }
    ])
  );

  const tasksWithEffectiveCoordinator = tasks.map((task) => ({
    ...task,
    coordinatorAlias: resolveEffectiveCoordinatorAliasFromMap(task.id, byId)
  }));

  const ownedTaskIds = new Set(
    tasksWithEffectiveCoordinator
      .filter((task) => task.coordinatorAlias === sessionUser.alias)
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

  const ownedOrOpen = tasksWithEffectiveCoordinator.filter(
    (task) => task.status === TaskStatus.BESCHIKBAAR || isOwnedBranchTask(task.id)
  );

  return NextResponse.json({ data: ownedOrOpen }, { status: 200 });
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

  let parentTask = null;
  if (parsed.data.parentId) {
    parentTask = await prisma.task.findUnique({ where: { id: parsed.data.parentId } });
    if (!parentTask) {
      return NextResponse.json({ error: "Parent-taak niet gevonden" }, { status: 404 });
    }

    const canCreateUnderParent = await canManageTaskByOwnership(
      sessionUser.alias,
      parentTask.id
    );
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

  const ownCoordinatorAlias = parentTask ? null : sessionUser.alias;

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      teamName: parsed.data.teamName,
      parentId: parsed.data.parentId,
      ownCoordinatorAlias,
      points: parsed.data.points.toString(),
      date: new Date(parsed.data.date),
      startTime: parsed.data.startTime ? new Date(parsed.data.startTime) : null,
      endTime: new Date(parsed.data.endTime),
      location: parsed.data.location,
      templateId: parsed.data.templateId,
      status: TaskStatus.BESCHIKBAAR
    }
  });

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_CREATED",
    entityType: "Task",
    entityId: task.id,
    payload: { parentId: task.parentId, ownCoordinatorAlias: task.ownCoordinatorAlias }
  });

  return NextResponse.json({ data: task }, { status: 201 });
}
