import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import {
  hasTaskPermissionFromMap,
  isBestuurAlias,
  resolveEffectiveCoordinatorAliasesFromMap
} from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { parseStoredPoints } from "@/lib/task-points";

const querySchema = z.object({
  at: z.string().datetime().optional(),
  view: z.enum(["SUMMARY", "DETAIL"]).optional()
});

type TaskRow = {
  id: string;
  title: string;
  parentId: string | null;
  coordinationType: "DELEGEREN" | "ORGANISEREN" | null;
  points: number;
  date: Date;
  startTime: Date | null;
  endTime: Date;
  ownCoordinators: Array<{ userAlias: string }>;
};

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function elapsedRatio(startAt: Date, endAt: Date, at: Date): number {
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();
  const nowMs = at.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(nowMs)) {
    return 0;
  }
  if (endMs <= startMs) {
    return nowMs >= endMs ? 1 : 0;
  }
  if (nowMs <= startMs) {
    return 0;
  }
  if (nowMs >= endMs) {
    return 1;
  }

  return clamp01((nowMs - startMs) / (endMs - startMs));
}

function escapeCsv(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, "\"\"");
  return needsQuotes ? `"${escaped}"` : escaped;
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

function formatDateTimeForCsv(value: Date): string {
  const year = value.getFullYear().toString().padStart(4, "0");
  const month = (value.getMonth() + 1).toString().padStart(2, "0");
  const day = value.getDate().toString().padStart(2, "0");
  const hours = value.getHours().toString().padStart(2, "0");
  const minutes = value.getMinutes().toString().padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { id: rootTaskId } = await context.params;
  const query = querySchema.safeParse({
    at: new URL(request.url).searchParams.get("at") ?? undefined,
    view: (new URL(request.url).searchParams.get("view") ?? undefined)?.toUpperCase()
  });
  if (!query.success) {
    return NextResponse.json({ error: "Ongeldige query" }, { status: 400 });
  }
  const asOf = query.data.at ? new Date(query.data.at) : new Date();
  const view = query.data.view ?? "SUMMARY";

  const tasks: TaskRow[] = await prisma.task.findMany({
    select: {
      id: true,
      title: true,
      parentId: true,
      coordinationType: true,
      points: true,
      date: true,
      startTime: true,
      endTime: true,
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

  const childrenByParentId = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }
    const current = childrenByParentId.get(task.parentId);
    if (current) {
      current.push(task);
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
    const children = childrenByParentId.get(currentId) ?? [];
    for (const child of children) {
      queue.push(child.id);
    }
  }

  const pathByTaskId = new Map<string, string>();
  const pathQueue = [rootTaskId];
  pathByTaskId.set(rootTaskId, rootTask.title);
  while (pathQueue.length > 0) {
    const currentId = pathQueue.shift();
    if (!currentId) {
      continue;
    }
    const currentPath = pathByTaskId.get(currentId) ?? "";
    for (const child of childrenByParentId.get(currentId) ?? []) {
      if (!subtreeTaskIds.has(child.id) || pathByTaskId.has(child.id)) {
        continue;
      }
      pathByTaskId.set(child.id, `${currentPath} > ${child.title}`);
      pathQueue.push(child.id);
    }
  }

  const directChildPointsByParentId = new Map<string, number>();
  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }
    const previous = directChildPointsByParentId.get(task.parentId) ?? 0;
    directChildPointsByParentId.set(task.parentId, previous + parseStoredPoints(task.points));
  }

  const pointsByAlias = new Map<string, number>();
  const detailedRows: Array<{
    path: string;
    taskTitle: string;
    alias: string;
    startAt: Date;
    endAt: Date;
    totalPoints: number;
    partialPoints: number;
  }> = [];

  for (const task of tasks) {
    if (!subtreeTaskIds.has(task.id)) {
      continue;
    }

    const ownCoordinatorAliases = uniqueSortedAliases(task.ownCoordinators.map((item) => item.userAlias));
    const effectiveCoordinatorAliases = resolveEffectiveCoordinatorAliasesFromMap(task.id, tasksById);
    const assigneeAliases =
      ownCoordinatorAliases.length > 0 ? ownCoordinatorAliases : effectiveCoordinatorAliases;
    if (assigneeAliases.length === 0) {
      continue;
    }

    const ownPoints = parseStoredPoints(task.points);
    const issuedToDirectChildren = directChildPointsByParentId.get(task.id) ?? 0;
    const availablePoints = Math.max(0, ownPoints - issuedToDirectChildren);
    if (availablePoints <= 0) {
      continue;
    }

    const startAt = task.startTime ?? task.date;
    const ratio = elapsedRatio(startAt, task.endTime, asOf);
    const elapsedPoints = Math.floor(availablePoints * ratio);
    const totalPointsPerAlias = Math.floor(availablePoints / assigneeAliases.length);
    const pointsPerAlias = Math.floor(elapsedPoints / assigneeAliases.length);
    for (const alias of assigneeAliases) {
      detailedRows.push({
        path: pathByTaskId.get(task.id) ?? task.title,
        taskTitle: task.title,
        alias,
        startAt,
        endAt: task.endTime,
        totalPoints: totalPointsPerAlias,
        partialPoints: pointsPerAlias
      });
      if (pointsPerAlias > 0) {
        pointsByAlias.set(alias, (pointsByAlias.get(alias) ?? 0) + pointsPerAlias);
      }
    }
  }

  const aliases = uniqueSortedAliases([
    ...Array.from(pointsByAlias.keys()),
    ...detailedRows.map((row) => row.alias)
  ]);
  const users = aliases.length > 0
    ? await prisma.user.findMany({
        where: { alias: { in: aliases } },
        select: {
          alias: true,
          bondsnummer: true
        }
      })
    : [];
  const bondsnummerByAlias = new Map(users.map((user) => [user.alias, user.bondsnummer]));

  if (view === "DETAIL") {
    const detailRows = detailedRows
      .sort((left, right) => {
        const byPath = left.path.localeCompare(right.path, "nl-NL");
        if (byPath !== 0) {
          return byPath;
        }
        const byAlias = left.alias.localeCompare(right.alias, "nl-NL");
        if (byAlias !== 0) {
          return byAlias;
        }
        return left.taskTitle.localeCompare(right.taskTitle, "nl-NL");
      })
      .map((row) =>
        [
          escapeCsv(row.path),
          escapeCsv(row.taskTitle),
          escapeCsv(row.alias),
          escapeCsv(bondsnummerByAlias.get(row.alias) ?? "ONBEKEND"),
          row.totalPoints.toString(),
          escapeCsv(formatDateTimeForCsv(row.startAt)),
          escapeCsv(formatDateTimeForCsv(row.endAt)),
          row.partialPoints.toString()
        ].join(",")
      );

    const detailCsv = [
      "pad,taaknaam,alias,relatiecode,totaal,start,eind,deel",
      ...detailRows
    ].join("\n");
    const detailFilename = [
      "punten_detail",
      toFileSafeFragment(rootTask.title),
      formatTimestampForFilename(asOf)
    ].join("_");

    return new NextResponse(detailCsv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${detailFilename}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  }

  const pointsByRelatiecode = new Map<string, number>();
  for (const [alias, points] of pointsByAlias.entries()) {
    const relatiecode = bondsnummerByAlias.get(alias) ?? "ONBEKEND";
    pointsByRelatiecode.set(relatiecode, (pointsByRelatiecode.get(relatiecode) ?? 0) + points);
  }

  const rows = Array.from(pointsByRelatiecode.entries())
    .sort(([leftCode], [rightCode]) => leftCode.localeCompare(rightCode, "nl-NL"))
    .map(([relatiecode, points]) => `${escapeCsv(relatiecode)},${points.toString()}`);

  const csv = ["relatiecode,punten", ...rows].join("\n");
  const filename = [
    "punten",
    toFileSafeFragment(rootTask.title),
    formatTimestampForFilename(asOf)
  ].join("_");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
