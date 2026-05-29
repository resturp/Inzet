#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient, TaskCoordinationType, TaskStatus } from "@prisma/client";

const prisma = new PrismaClient();

function usage() {
  console.error(
    [
      "Gebruik:",
      "  node scripts/import-task-backup.mjs <backup.json> --replace-all [--dry-run]",
      "",
      "Voorbeeld:",
      "  node scripts/import-task-backup.mjs data/alle_taken_backup_vc-zwolle_20260529-2110.json --replace-all"
    ].join("\n")
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let filePath = "";
  let replaceAll = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--replace-all") {
      replaceAll = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!filePath) {
      filePath = arg;
      continue;
    }
    throw new Error(`Onbekende extra parameter: ${arg}`);
  }

  if (!filePath) {
    throw new Error("Backupbestand ontbreekt.");
  }

  return { filePath, replaceAll, dryRun };
}

function ensureString(value, fieldName) {
  if (typeof value !== "string") {
    throw new Error(`Veld ${fieldName} moet een string zijn.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Veld ${fieldName} mag niet leeg zijn.`);
  }
  return trimmed;
}

function ensureNullableString(value, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Veld ${fieldName} moet een string of null zijn.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureDate(value, fieldName) {
  const normalized = ensureString(value, fieldName);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Veld ${fieldName} bevat geen geldige datum: ${normalized}`);
  }
  return parsed;
}

function ensureNonNegativeInteger(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Veld ${fieldName} moet een geheel getal >= 0 zijn.`);
  }
  return value;
}

function ensureStatus(value, fieldName) {
  if (value === TaskStatus.BESCHIKBAAR || value === TaskStatus.TOEGEWEZEN || value === TaskStatus.GEREED) {
    return value;
  }
  throw new Error(`Veld ${fieldName} bevat ongeldige status: ${String(value)}`);
}

function ensureOwnCoordinationType(value, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value === TaskCoordinationType.DELEGEREN || value === TaskCoordinationType.ORGANISEREN) {
    return value;
  }
  throw new Error(`Veld ${fieldName} bevat ongeldig coordinatietype: ${String(value)}`);
}

function uniqueSortedAliases(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right, "nl-NL"));
}

function parseBackup(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Backup JSON heeft ongeldige structuur.");
  }

  const meta = payload.meta ?? {};
  if (meta.exportType && meta.exportType !== "TASK_TREE_BACKUP") {
    throw new Error(`Onbekend exportType: ${String(meta.exportType)}`);
  }

  const rootTask = payload.rootTask;
  if (!rootTask || typeof rootTask !== "object") {
    throw new Error("Backup mist rootTask.");
  }

  function parseNode(node, fieldPath, expectedParentId) {
    if (!node || typeof node !== "object") {
      throw new Error(`Node ${fieldPath} is ongeldig.`);
    }

    const sourceId = ensureString(node.id, `${fieldPath}.id`);
    const sourceParentId =
      node.parentId === null || node.parentId === undefined
        ? null
        : ensureString(node.parentId, `${fieldPath}.parentId`);

    // Root node mag uit een bestaande boom geëxporteerd zijn en dan een parentId hebben.
    // Die root parentId negeren we bij import-als-child.
    if (expectedParentId !== null && sourceParentId !== expectedParentId) {
      throw new Error(`Node ${fieldPath} heeft een ongeldige parentId-relatie.`);
    }

    const title = ensureString(node.title, `${fieldPath}.title`);
    const description = ensureString(node.description, `${fieldPath}.description`);
    const longDescription = ensureNullableString(node.longDescription, `${fieldPath}.longDescription`);
    const teamName = ensureNullableString(node.teamName, `${fieldPath}.teamName`);
    const location = ensureNullableString(node.location, `${fieldPath}.location`);
    const points = ensureNonNegativeInteger(node.points, `${fieldPath}.points`);
    const status = ensureStatus(node.status, `${fieldPath}.status`);
    const date = ensureDate(node.date, `${fieldPath}.date`);
    const startTime = node.startTime === null ? null : ensureDate(node.startTime, `${fieldPath}.startTime`);
    const endTime = ensureDate(node.endTime, `${fieldPath}.endTime`);
    const createdAt =
      node.createdAt === null || node.createdAt === undefined
        ? new Date()
        : ensureDate(node.createdAt, `${fieldPath}.createdAt`);

    const ownCoordinationType = ensureOwnCoordinationType(
      node.settings?.ownCoordinationType ?? null,
      `${fieldPath}.settings.ownCoordinationType`
    );

    const ownAliases = uniqueSortedAliases(node.coordinators?.ownAliases ?? []);
    const childrenRaw = Array.isArray(node.children) ? node.children : [];
    const children = childrenRaw.map((child, index) =>
      parseNode(child, `${fieldPath}.children[${index}]`, sourceId)
    );

    return {
      title,
      description,
      longDescription,
      teamName,
      points,
      date,
      startTime,
      endTime,
      location,
      status,
      coordinationType: ownCoordinationType,
      createdAt,
      ownAliases,
      children
    };
  }

  return { rootNode: parseNode(rootTask, "rootTask", null), meta };
}

function collectOwnAliases(rootNode) {
  const aliases = [];
  const stack = [rootNode];
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

function summarizeTree(rootNode) {
  let taskCount = 0;
  let coordinatorLinkCount = 0;
  const stack = [rootNode];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    taskCount += 1;
    coordinatorLinkCount += current.ownAliases.length;
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return { taskCount, coordinatorLinkCount };
}

async function run() {
  const { filePath, replaceAll, dryRun } = parseArgs(process.argv);
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const payload = JSON.parse(raw);
  const { rootNode, meta } = parseBackup(payload);

  if (!replaceAll) {
    throw new Error("Gebruik expliciet --replace-all om bestaande taken te vervangen.");
  }

  const aliasesInBackup = collectOwnAliases(rootNode);
  const { taskCount, coordinatorLinkCount } = summarizeTree(rootNode);
  const existingUsers = await prisma.user.findMany({
    where: { alias: { in: aliasesInBackup } },
    select: { alias: true }
  });
  const existingAliasSet = new Set(existingUsers.map((user) => user.alias));
  const missingAliases = aliasesInBackup.filter((alias) => !existingAliasSet.has(alias));
  if (missingAliases.length > 0) {
    throw new Error(
      `Import gestopt: ${missingAliases.length} coordinator-alias(sen) ontbreken op deze omgeving: ${missingAliases.join(", ")}`
    );
  }

  console.log(`Bestand: ${absolutePath}`);
  console.log(`ExportType: ${meta.exportType ?? "onbekend"}`);
  console.log(`Root: ${meta.rootTaskTitle ?? rootNode.title ?? "onbekend"}`);
  console.log(`Taken: ${taskCount}`);
  console.log(`Coordinator-koppelingen: ${coordinatorLinkCount}`);
  console.log(`Unieke coordinatoren: ${aliasesInBackup.length}`);
  console.log("ID beleid: backup IDs worden genegeerd; nieuwe task IDs worden gegenereerd.");
  console.log(`Mode: ${dryRun ? "DRY RUN (geen writes)" : "IMPORT"}`);

  if (dryRun) {
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('TRUNCATE TABLE "Task" CASCADE');

      async function createNode(node, parentId) {
        const createdTask = await tx.task.create({
          data: {
            title: node.title,
            description: node.description,
            longDescription: node.longDescription,
            teamName: node.teamName,
            parentId,
            points: node.points,
            date: node.date,
            startTime: node.startTime,
            endTime: node.endTime,
            location: node.location,
            status: node.status,
            coordinationType: node.coordinationType,
            createdAt: node.createdAt
          },
          select: { id: true }
        });

        if (node.ownAliases.length > 0) {
          await tx.taskCoordinator.createMany({
            data: node.ownAliases.map((userAlias) => ({
              taskId: createdTask.id,
              userAlias
            }))
          });
        }

        for (const child of node.children) {
          await createNode(child, createdTask.id);
        }
      }

      await createNode(rootNode, null);
    },
    {
      maxWait: 10000,
      timeout: 120000
    }
  );

  console.log("Import voltooid.");
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
