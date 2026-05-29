import { TaskCoordinationType, TaskStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { canManageTaskByOwnership } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

type BackupTaskNode = {
  title: string;
  description: string;
  longDescription: string | null;
  teamName: string | null;
  points: number;
  status: TaskStatus;
  date: Date;
  startTime: Date | null;
  endTime: Date;
  location: string | null;
  ownCoordinationType: TaskCoordinationType | null;
  ownAliases: string[];
  children: BackupTaskNode[];
};

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function ensureString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Veld ${fieldName} moet een string zijn.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Veld ${fieldName} mag niet leeg zijn.`);
  }
  return trimmed;
}

function ensureNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Veld ${fieldName} moet string of null zijn.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureDate(value: unknown, fieldName: string): Date {
  const raw = ensureString(value, fieldName);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Veld ${fieldName} bevat geen geldige datum.`);
  }
  return parsed;
}

function ensureNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Veld ${fieldName} moet een geheel getal >= 0 zijn.`);
  }
  return value;
}

function ensureStatus(value: unknown, fieldName: string): TaskStatus {
  if (value === TaskStatus.BESCHIKBAAR || value === TaskStatus.TOEGEWEZEN || value === TaskStatus.GEREED) {
    return value;
  }
  throw new Error(`Veld ${fieldName} heeft een ongeldige status.`);
}

function ensureOwnCoordinationType(
  value: unknown,
  fieldName: string
): TaskCoordinationType | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value === TaskCoordinationType.DELEGEREN || value === TaskCoordinationType.ORGANISEREN) {
    return value;
  }
  throw new Error(`Veld ${fieldName} heeft een ongeldig coordinatietype.`);
}

function parseBackupNode(
  rawNode: unknown,
  fieldPath: string,
  expectedParentId: string | null
): BackupTaskNode {
  if (!rawNode || typeof rawNode !== "object") {
    throw new Error(`Node ${fieldPath} is ongeldig.`);
  }

  const node = rawNode as Record<string, unknown>;
  const sourceId = ensureString(node.id, `${fieldPath}.id`);
  const sourceParentId =
    node.parentId === null || node.parentId === undefined
      ? null
      : ensureString(node.parentId, `${fieldPath}.parentId`);

  if (expectedParentId === null && sourceParentId !== null) {
    throw new Error(`Node ${fieldPath} heeft een ongeldige parentId-relatie.`);
  }
  if (expectedParentId !== null && sourceParentId !== expectedParentId) {
    throw new Error(`Node ${fieldPath} heeft een ongeldige parentId-relatie.`);
  }

  const ownAliasesRaw = node.coordinators && typeof node.coordinators === "object"
    ? (node.coordinators as Record<string, unknown>).ownAliases
    : [];

  const ownAliases = uniqueSortedAliases(
    Array.isArray(ownAliasesRaw)
      ? ownAliasesRaw
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : []
  );

  const settings = node.settings && typeof node.settings === "object"
    ? (node.settings as Record<string, unknown>)
    : {};

  const childrenRaw = Array.isArray(node.children) ? node.children : [];

  return {
    title: ensureString(node.title, `${fieldPath}.title`),
    description: ensureString(node.description, `${fieldPath}.description`),
    longDescription: ensureNullableString(node.longDescription, `${fieldPath}.longDescription`),
    teamName: ensureNullableString(node.teamName, `${fieldPath}.teamName`),
    points: ensureNonNegativeInteger(node.points, `${fieldPath}.points`),
    status: ensureStatus(node.status, `${fieldPath}.status`),
    date: ensureDate(node.date, `${fieldPath}.date`),
    startTime: node.startTime === null ? null : ensureDate(node.startTime, `${fieldPath}.startTime`),
    endTime: ensureDate(node.endTime, `${fieldPath}.endTime`),
    location: ensureNullableString(node.location, `${fieldPath}.location`),
    ownCoordinationType: ensureOwnCoordinationType(
      settings.ownCoordinationType,
      `${fieldPath}.settings.ownCoordinationType`
    ),
    ownAliases,
    children: childrenRaw.map((child, index) =>
      parseBackupNode(child, `${fieldPath}.children[${index}]`, sourceId)
    )
  };
}

function collectOwnAliases(root: BackupTaskNode): string[] {
  const aliases: string[] = [];
  const stack: BackupTaskNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    aliases.push(...current.ownAliases);
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return uniqueSortedAliases(aliases);
}

async function hasCompletedAncestor(taskId: string): Promise<boolean> {
  const visited = new Set<string>([taskId]);
  let current = await prisma.task.findUnique({
    where: { id: taskId },
    select: { parentId: true }
  });

  while (current?.parentId) {
    const parentId = current.parentId;
    if (visited.has(parentId)) {
      break;
    }
    visited.add(parentId);

    const parent = await prisma.task.findUnique({
      where: { id: parentId },
      select: { id: true, parentId: true, status: true }
    });
    if (!parent) {
      break;
    }
    if (parent.status === TaskStatus.GEREED) {
      return true;
    }
    current = { parentId: parent.parentId };
  }

  return false;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id: parentTaskId } = await context.params;
  const parentTask = await prisma.task.findUnique({
    where: { id: parentTaskId },
    select: { id: true, title: true, status: true }
  });
  if (!parentTask) {
    return NextResponse.json({ error: "Doeltaak niet gevonden" }, { status: 404 });
  }

  const canManage = await canManageTaskByOwnership(sessionUser.alias, parentTaskId);
  if (!canManage) {
    return NextResponse.json({ error: "Geen rechten op deze taak" }, { status: 403 });
  }

  if (parentTask.status === TaskStatus.GEREED || (await hasCompletedAncestor(parentTask.id))) {
    return NextResponse.json(
      { error: "Importeren is geblokkeerd onder een gereed gemelde taak." },
      { status: 409 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload een JSON-bestand." }, { status: 400 });
  }

  let backupPayload: unknown;
  try {
    backupPayload = JSON.parse(await file.text());
  } catch {
    return NextResponse.json({ error: "Bestand bevat geen geldige JSON." }, { status: 400 });
  }

  const rootTaskRaw =
    backupPayload && typeof backupPayload === "object"
      ? (backupPayload as Record<string, unknown>).rootTask
      : null;
  if (!rootTaskRaw) {
    return NextResponse.json({ error: "Backup mist rootTask." }, { status: 400 });
  }

  let rootNode: BackupTaskNode;
  try {
    rootNode = parseBackupNode(rootTaskRaw, "rootTask", null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ongeldige backupstructuur.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const aliases = collectOwnAliases(rootNode);
  if (aliases.length > 0) {
    const existingUsers = await prisma.user.findMany({
      where: { alias: { in: aliases } },
      select: { alias: true }
    });
    const existingSet = new Set(existingUsers.map((user) => user.alias));
    const missingAliases = aliases.filter((alias) => !existingSet.has(alias));
    if (missingAliases.length > 0) {
      return NextResponse.json(
        {
          error: `Import gestopt: onbekende alias(sen): ${missingAliases.join(", ")}`
        },
        { status: 400 }
      );
    }
  }

  let createdTaskCount = 0;
  let createdCoordinatorLinkCount = 0;

  await prisma.$transaction(
    async (tx) => {
      async function createNode(node: BackupTaskNode, targetParentId: string): Promise<void> {
        const createdTask = await tx.task.create({
          data: {
            title: node.title,
            description: node.description,
            longDescription: node.longDescription,
            teamName: node.teamName,
            parentId: targetParentId,
            points: node.points,
            date: node.date,
            startTime: node.startTime,
            endTime: node.endTime,
            location: node.location,
            status: node.status,
            coordinationType: node.ownCoordinationType
          },
          select: { id: true }
        });
        createdTaskCount += 1;

        if (node.ownAliases.length > 0) {
          await tx.taskCoordinator.createMany({
            data: node.ownAliases.map((userAlias) => ({
              taskId: createdTask.id,
              userAlias
            }))
          });
          createdCoordinatorLinkCount += node.ownAliases.length;
        }

        for (const child of node.children) {
          await createNode(child, createdTask.id);
        }
      }

      await createNode(rootNode, parentTask.id);
    },
    {
      maxWait: 10000,
      timeout: 120000
    }
  );

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "TASK_TREE_IMPORTED_AS_CHILD",
    entityType: "Task",
    entityId: parentTask.id,
    payload: {
      importedFileName: file.name || null,
      importedRootTitle: rootNode.title,
      createdTaskCount,
      createdCoordinatorLinkCount
    }
  });

  return NextResponse.json(
    {
      data: {
        parentTaskId: parentTask.id,
        parentTaskTitle: parentTask.title,
        importedRootTitle: rootNode.title,
        createdTaskCount,
        createdCoordinatorLinkCount
      }
    },
    { status: 200 }
  );
}
