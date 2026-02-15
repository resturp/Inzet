import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

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

  const parentTask = await prisma.task.findUnique({ where: { id: parentTaskId } });
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

  const teamCoordinatorTask = await prisma.task.create({
    data: {
      title: `Coachen ${parsed.data.teamName}`,
      description: `Coordinatietaak voor team ${parsed.data.teamName}`,
      teamName: parsed.data.teamName,
      parentId: parentTask.id,
      ownCoordinatorAlias: null,
      points: "100",
      date: baseDate,
      endTime,
      templateId: template.id,
      status: TaskStatus.TOEGEWEZEN
    }
  });

  const childTemplates = await prisma.taskTemplate.findMany({
    where: { parentTemplateId: template.id },
    orderBy: { title: "asc" }
  });

  const subtasks = [];
  for (const child of childTemplates) {
    const task = await prisma.task.create({
      data: {
        title: child.title,
        description: child.description,
        teamName: parsed.data.teamName,
        parentId: teamCoordinatorTask.id,
        ownCoordinatorAlias: null,
        points: child.defaultPoints?.toString() ?? "10",
        date: baseDate,
        endTime,
        templateId: child.id,
        status: TaskStatus.BESCHIKBAAR
      }
    });
    subtasks.push(task);
  }

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TEMPLATE_APPLIED",
    entityType: "TaskTemplate",
    entityId: template.id,
    payload: {
      teamName: parsed.data.teamName,
      parentTaskId: parentTask.id,
      createdTaskId: teamCoordinatorTask.id,
      createdSubtasks: subtasks.map((item) => item.id)
    }
  });

  return NextResponse.json(
    {
      data: {
        createdCoordinatorTaskId: teamCoordinatorTask.id,
        createdSubtaskCount: subtasks.length
      }
    },
    { status: 201 }
  );
}
