import { TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

const copySchema = z.object({
  targetParentId: z.string().trim().min(1),
  rootOverride: z
    .object({
      title: z.string().trim().min(2).optional(),
      description: z.string().trim().min(2).optional(),
      teamName: z.string().trim().max(100).nullable().optional(),
      points: z.number().finite().nonnegative().optional(),
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
  teamName: string | null;
  parentId: string | null;
  ownCoordinatorAliases: string[];
  points: { toString: () => string };
  date: Date;
  startTime: Date | null;
  endTime: Date;
  location: string | null;
  templateId: string | null;
};

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

  const [canManageSource, canManageSourceParent, canManageTarget] = await Promise.all([
    canManageTaskByOwnership(sessionUser.alias, sourceTaskId),
    canManageTaskByOwnership(sessionUser.alias, sourceTaskContext.parentId),
    canManageTaskByOwnership(sessionUser.alias, parsed.data.targetParentId)
  ]);
  if (!canManageSource || !canManageSourceParent || !canManageTarget) {
    return NextResponse.json(
      { error: "Geen rechten om deze subtaak te kopieren" },
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
            teamName: true,
            parentId: true,
            ownCoordinators: {
              select: { userAlias: true }
            },
            points: true,
            date: true,
            startTime: true,
            endTime: true,
            location: true,
            templateId: true
          }
        }),
        tx.task.findUnique({
          where: { id: parsed.data.targetParentId },
          select: { id: true }
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
            teamName: true,
            parentId: true,
            ownCoordinators: {
              select: { userAlias: true }
            },
            points: true,
            date: true,
            startTime: true,
            endTime: true,
            location: true,
            templateId: true
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

      const override = parsed.data.rootOverride;
      const createdIds: string[] = [];

      const rootCopy = await tx.task.create({
        data: {
          title: override?.title ?? sourceTask.title,
          description: override?.description ?? sourceTask.description,
          teamName:
            override?.teamName === undefined ? sourceTask.teamName : override.teamName,
          parentId: targetParent.id,
          ownCoordinators: coordinatorCreateData(sourceTask.ownCoordinatorAliases),
          points:
            override?.points !== undefined
              ? override.points.toString()
              : sourceTask.points.toString(),
          date: override?.date ? new Date(override.date) : sourceTask.date,
          startTime:
            override?.startTime === undefined
              ? sourceTask.startTime
              : override.startTime
                ? new Date(override.startTime)
                : null,
          endTime: override?.endTime ? new Date(override.endTime) : sourceTask.endTime,
          location:
            override?.location === undefined ? sourceTask.location : override.location,
          templateId: sourceTask.templateId,
          status: TaskStatus.BESCHIKBAAR
        }
      });
      createdIds.push(rootCopy.id);

      async function cloneChildren(oldParentId: string, newParentId: string): Promise<void> {
        const children = childrenByParent.get(oldParentId) ?? [];
        for (const child of children) {
          const createdChild = await tx.task.create({
            data: {
              title: child.title,
              description: child.description,
              teamName: child.teamName,
              parentId: newParentId,
              ownCoordinators: coordinatorCreateData(child.ownCoordinatorAliases),
              points: child.points.toString(),
              date: child.date,
              startTime: child.startTime,
              endTime: child.endTime,
              location: child.location,
              templateId: child.templateId,
              status: TaskStatus.BESCHIKBAAR
            }
          });
          createdIds.push(createdChild.id);
          await cloneChildren(child.id, createdChild.id);
        }
      }

      await cloneChildren(sourceTask.id, rootCopy.id);

      return {
        rootId: rootCopy.id,
        createdCount: createdIds.length
      };
    });

    await writeAuditLog({
      actorAlias: sessionUser.alias,
      actionType: "TASK_SUBTREE_COPIED",
      entityType: "Task",
      entityId: sourceTaskId,
      payload: {
        targetParentId: parsed.data.targetParentId,
        newRootId: result.rootId,
        createdCount: result.createdCount
      }
    });

    return NextResponse.json({ data: result }, { status: 201 });
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
