import { NextResponse } from "next/server";
import {
  hasTaskPermissionFromMap,
  isBestuurAlias,
  resolveEffectiveCoordinationTypeFromMap,
  resolveEffectiveCoordinatorAliasesFromMap
} from "@/lib/authorization";
import { getSessionUser } from "@/lib/api-session";
import { prisma } from "@/lib/prisma";
import { parseStoredPoints } from "@/lib/task-points";

type TaskRow = {
  id: string;
  title: string;
  description: string;
  longDescription: string | null;
  teamName: string | null;
  parentId: string | null;
  points: number;
  status: "BESCHIKBAAR" | "TOEGEWEZEN" | "GEREED";
  date: Date;
  startTime: Date | null;
  endTime: Date;
  location: string | null;
  coordinationType: "DELEGEREN" | "ORGANISEREN" | null;
  createdAt: Date;
  ownCoordinators: Array<{ userAlias: string }>;
};

type BackupTaskNode = {
  id: string;
  title: string;
  description: string;
  longDescription: string | null;
  teamName: string | null;
  parentId: string | null;
  points: number;
  status: "BESCHIKBAAR" | "TOEGEWEZEN" | "GEREED";
  date: string;
  startTime: string | null;
  endTime: string;
  location: string | null;
  createdAt: string;
  coordinators: {
    ownAliases: string[];
    effectiveAliases: string[];
  };
  settings: {
    ownCoordinationType: "DELEGEREN" | "ORGANISEREN" | null;
    effectiveCoordinationType: "DELEGEREN" | "ORGANISEREN";
  };
  children: BackupTaskNode[];
};

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function toFileSafeFragment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return normalized.slice(0, 50) || "taak";
}

function formatTimestampForFilename(value: Date): string {
  const year = value.getFullYear().toString().padStart(4, "0");
  const month = (value.getMonth() + 1).toString().padStart(2, "0");
  const day = value.getDate().toString().padStart(2, "0");
  const hours = value.getHours().toString().padStart(2, "0");
  const minutes = value.getMinutes().toString().padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id: rootTaskId } = await context.params;
  const tasks: TaskRow[] = await prisma.task.findMany({
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      longDescription: true,
      teamName: true,
      parentId: true,
      points: true,
      status: true,
      date: true,
      startTime: true,
      endTime: true,
      location: true,
      coordinationType: true,
      createdAt: true,
      ownCoordinators: {
        select: { userAlias: true }
      }
    }
  });

  const rootTask = tasks.find((task) => task.id === rootTaskId);
  if (!rootTask) {
    return NextResponse.json({ error: "Taak niet gevonden" }, { status: 404 });
  }

  const tasksById = new Map(
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

  const sessionIsBestuur = await isBestuurAlias(sessionUser.alias);
  const canRead = hasTaskPermissionFromMap(sessionUser.alias, rootTaskId, "READ", tasksById);
  const canOpen = hasTaskPermissionFromMap(sessionUser.alias, rootTaskId, "OPEN", tasksById);
  const canManage = hasTaskPermissionFromMap(sessionUser.alias, rootTaskId, "MANAGE", tasksById);

  const ownedTaskIds = new Set(
    Array.from(tasksById.keys()).filter((taskId) =>
      hasTaskPermissionFromMap(sessionUser.alias, taskId, "MANAGE", tasksById)
    )
  );

  function isOwnedBranchTask(taskId: string): boolean {
    const visited = new Set<string>();
    let current = tasksById.get(taskId);
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
      current = tasksById.get(current.parentId);
    }
    return false;
  }

  const canExport = sessionIsBestuur || canRead || canOpen || canManage || isOwnedBranchTask(rootTaskId);
  if (!canExport) {
    return NextResponse.json({ error: "Geen rechten voor deze export" }, { status: 403 });
  }

  const fullTaskById = new Map(tasks.map((task) => [task.id, task]));
  const childrenByParentId = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }
    const siblings = childrenByParentId.get(task.parentId);
    if (siblings) {
      siblings.push(task);
      continue;
    }
    childrenByParentId.set(task.parentId, [task]);
  }

  const subtreeTaskIds = new Set<string>();
  const queue = [rootTaskId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || subtreeTaskIds.has(currentId)) {
      continue;
    }
    subtreeTaskIds.add(currentId);
    for (const child of childrenByParentId.get(currentId) ?? []) {
      queue.push(child.id);
    }
  }

  function buildNode(taskId: string, ancestry: Set<string>): BackupTaskNode {
    const task = fullTaskById.get(taskId);
    if (!task) {
      throw new Error(`Task not found while building backup tree: ${taskId}`);
    }

    const ownAliases = uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias));
    const effectiveAliases = resolveEffectiveCoordinatorAliasesFromMap(taskId, tasksById);
    const effectiveCoordinationType = resolveEffectiveCoordinationTypeFromMap(taskId, tasksById);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(taskId);

    const children = (childrenByParentId.get(taskId) ?? [])
      .filter((child) => subtreeTaskIds.has(child.id) && !ancestry.has(child.id))
      .map((child) => buildNode(child.id, nextAncestry));

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      longDescription: task.longDescription,
      teamName: task.teamName,
      parentId: task.parentId,
      points: parseStoredPoints(task.points),
      status: task.status,
      date: task.date.toISOString(),
      startTime: task.startTime ? task.startTime.toISOString() : null,
      endTime: task.endTime.toISOString(),
      location: task.location,
      createdAt: task.createdAt.toISOString(),
      coordinators: {
        ownAliases,
        effectiveAliases
      },
      settings: {
        ownCoordinationType: task.coordinationType,
        effectiveCoordinationType
      },
      children
    };
  }

  const now = new Date();
  const payload = {
    meta: {
      exportType: "TASK_TREE_BACKUP",
      schemaVersion: 1,
      exportedAt: now.toISOString(),
      exportedByAlias: sessionUser.alias,
      rootTaskId: rootTask.id,
      rootTaskTitle: rootTask.title,
      taskCount: subtreeTaskIds.size
    },
    rootTask: buildNode(rootTaskId, new Set<string>())
  };

  const filename = [
    "alle_taken_backup",
    toFileSafeFragment(rootTask.title),
    formatTimestampForFilename(now)
  ].join("_");

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.json"`,
      "Cache-Control": "no-store"
    }
  });
}
