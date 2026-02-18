import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient, TaskStatus, UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();
const IMPORT_TIME_ZONE = "Europe/Amsterdam";

type CsvUser = {
  alias: string;
  password: string;
  email: string | null;
};

type TaskNode = {
  title: string;
  parentTitle: string | null;
  points: number;
  description: string;
  startAt: Date | null;
  endAt: Date | null;
  coordinatorAliases: Set<string>;
};

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (char === "\"") {
      const next = raw[index + 1];
      if (inQuotes && next === "\"") {
        currentCell += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && raw[index + 1] === "\n") {
        index += 1;
      }
      currentRow.push(currentCell.trim());
      const hasValues = currentRow.some((cell) => cell.length > 0);
      if (hasValues) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    const hasValues = currentRow.some((cell) => cell.length > 0);
    if (hasValues) {
      rows.push(currentRow);
    }
  }

  return rows;
}

async function readCsvFromFirstExisting(paths: string[]): Promise<string> {
  for (const candidate of paths) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch {
      // Try next path.
    }
  }
  return "";
}

function normalizeAlias(value: string): string {
  return value.trim();
}

function toSafeIdFragment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 20) : "user";
}

function generatedBondsnummer(alias: string, index: number): string {
  return `CSV-${toSafeIdFragment(alias)}-${String(index + 1).padStart(3, "0")}`;
}

function dateTimePartsInTimeZone(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  const year = Number(byType.get("year"));
  const month = Number(byType.get("month"));
  const day = Number(byType.get("day"));
  const hour = Number(byType.get("hour"));
  const minute = Number(byType.get("minute"));
  const second = Number(byType.get("second"));

  return { year, month, day, hour, minute, second };
}

function offsetMsForTimeZone(date: Date, timeZone: string): number {
  const parts = dateTimePartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );
  return asUtc - date.getTime();
}

function parseDateTime(value: string): Date | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/
  );
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");

  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const guessedUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let parsed = new Date(guessedUtc);
  let offsetMs = offsetMsForTimeZone(parsed, IMPORT_TIME_ZONE);
  parsed = new Date(guessedUtc - offsetMs);

  const correctedOffsetMs = offsetMsForTimeZone(parsed, IMPORT_TIME_ZONE);
  if (correctedOffsetMs !== offsetMs) {
    offsetMs = correctedOffsetMs;
    parsed = new Date(guessedUtc - offsetMs);
  }

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const zoned = dateTimePartsInTimeZone(parsed, IMPORT_TIME_ZONE);
  if (
    zoned.year !== year ||
    zoned.month !== month ||
    zoned.day !== day ||
    zoned.hour !== hour ||
    zoned.minute !== minute
  ) {
    return null;
  }

  return parsed;
}

async function seedUsersFromCsv(): Promise<Map<string, CsvUser>> {
  const raw = await readCsvFromFirstExisting([
    path.join(process.cwd(), "data", "user.csv"),
    path.join(process.cwd(), "data", "users.csv")
  ]);

  const rows = parseCsvRows(raw);
  const usersByAlias = new Map<string, CsvUser>();
  const usedEmails = new Set<string>();

  for (const row of rows) {
    const alias = normalizeAlias(row[0] ?? "");
    const password = (row[1] ?? "").trim();
    const emailRaw = (row[2] ?? "").trim().toLowerCase();
    const email = emailRaw.length > 0 ? emailRaw : null;

    if (!alias || !password) {
      continue;
    }

    const existing = usersByAlias.get(alias);
    const chosenEmail =
      email && (!usedEmails.has(email) || existing?.email === email) ? email : existing?.email ?? null;
    if (chosenEmail) {
      usedEmails.add(chosenEmail);
    }

    usersByAlias.set(alias, {
      alias,
      password,
      email: chosenEmail
    });
  }

  const aliases = Array.from(usersByAlias.keys()).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );

  for (let index = 0; index < aliases.length; index += 1) {
    const alias = aliases[index];
    const user = usersByAlias.get(alias);
    if (!user) {
      continue;
    }

    const passwordHash = await hashPassword(user.password);
    await prisma.user.upsert({
      where: { alias },
      update: {
        isActive: true,
        passwordHash,
        email: user.email,
        emailVerifiedAt: user.email ? new Date() : null
      },
      create: {
        alias,
        bondsnummer: generatedBondsnummer(alias, index),
        role: UserRole.LID,
        isActive: true,
        passwordHash,
        email: user.email,
        emailVerifiedAt: user.email ? new Date() : null
      }
    });
  }

  return usersByAlias;
}

async function ensureUserExists(alias: string, indexHint: number): Promise<void> {
  if (!alias) {
    return;
  }
  const existing = await prisma.user.findUnique({ where: { alias } });
  if (existing) {
    return;
  }
  await prisma.user.create({
    data: {
      alias,
      bondsnummer: generatedBondsnummer(alias, indexHint),
      role: UserRole.LID,
      isActive: true
    }
  });
}

async function seedTasksFromCsv(rootTemplateId: string | null): Promise<void> {
  const taskRaw = await readCsvFromFirstExisting([
    path.join(process.cwd(), "data", "task.csv"),
    path.join(process.cwd(), "data", "tasks.csv")
  ]);
  const coordRaw = await readCsvFromFirstExisting([
    path.join(process.cwd(), "data", "coord.csv"),
    path.join(process.cwd(), "data", "coords.csv")
  ]);

  const taskRows = parseCsvRows(taskRaw);
  const coordRows = parseCsvRows(coordRaw);

  const taskNodesByTitle = new Map<string, TaskNode>();
  const ensureNode = (title: string): TaskNode => {
    const normalizedTitle = title.trim();
    const existing = taskNodesByTitle.get(normalizedTitle);
    if (existing) {
      return existing;
    }
    const created: TaskNode = {
      title: normalizedTitle,
      parentTitle: null,
      points: 20,
      description: "",
      startAt: null,
      endAt: null,
      coordinatorAliases: new Set<string>()
    };
    taskNodesByTitle.set(normalizedTitle, created);
    return created;
  };

  for (const row of taskRows) {
    const title = (row[0] ?? "").trim();
    const parentTitle = (row[1] ?? "").trim();
    const rawPoints = Number((row[2] ?? "").trim());
    const points = Number.isFinite(rawPoints) ? Math.max(20, Math.round(rawPoints)) : 20;
    const description = (row[3] ?? "").trim();
    const startAt = parseDateTime(row[4] ?? "");
    const endAt = parseDateTime(row[5] ?? "");

    if (!title) {
      continue;
    }

    const node = ensureNode(title);
    if (parentTitle) {
      if (node.parentTitle && node.parentTitle !== parentTitle) {
        console.warn(
          `Parent-conflict voor taak "${title}": "${node.parentTitle}" blijft staan, "${parentTitle}" genegeerd`
        );
      } else {
        node.parentTitle = parentTitle;
      }
      ensureNode(parentTitle);
    }
    node.points = points;
    if (description) {
      node.description = description;
    }
    if (startAt) {
      node.startAt = startAt;
    }
    if (endAt) {
      node.endAt = endAt;
    }
  }

  for (const row of coordRows) {
    const title = (row[0] ?? "").trim();
    const coordinatorAlias = normalizeAlias(row[1] ?? "");
    if (!title) {
      continue;
    }
    const node = ensureNode(title);
    if (coordinatorAlias) {
      node.coordinatorAliases.add(coordinatorAlias);
    }
  }

  const rootTitle = "2025-2026";
  const rootNode = ensureNode(rootTitle);
  rootNode.parentTitle = null;

  for (const node of taskNodesByTitle.values()) {
    if (!node.parentTitle) {
      continue;
    }
    ensureNode(node.parentTitle);
  }

  const bestuurNode = taskNodesByTitle.get("Bestuur");
  const rootOwnerAlias =
    bestuurNode && bestuurNode.coordinatorAliases.size > 0
      ? Array.from(bestuurNode.coordinatorAliases).sort((left, right) =>
          left.localeCompare(right, "nl-NL")
        )[0] ?? "Bestuur"
      : "Bestuur";
  if (rootNode.coordinatorAliases.size === 0) {
    rootNode.coordinatorAliases.add(rootOwnerAlias);
  }

  const orderedTitles = Array.from(taskNodesByTitle.keys()).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
  let coordinatorIndex = 10_000;
  for (const node of taskNodesByTitle.values()) {
    for (const coordinatorAlias of node.coordinatorAliases) {
      await ensureUserExists(coordinatorAlias, coordinatorIndex);
      coordinatorIndex += 1;
    }
  }

  const seasonStart = new Date("2025-06-30T22:00:00.000Z");
  const seasonEnd = new Date("2026-06-30T21:59:00.000Z");
  const rootEnd = new Date("2029-12-31T23:00:00.000Z");

  const createdByTitle = new Map<string, { id: string }>();
  const unresolved = new Set(orderedTitles);

  const endTimeForTitle = (title: string): Date => (title === rootTitle ? rootEnd : seasonEnd);
  const descriptionForTitle = (title: string): string => {
    if (title === rootTitle) {
      return "Het besturen van de vereniging tijdens seizoen 2025-2026";
    }
    return `Taak: ${title}`;
  };

  while (unresolved.size > 0) {
    let progressed = false;

    for (const title of Array.from(unresolved)) {
      const node = taskNodesByTitle.get(title);
      if (!node) {
        unresolved.delete(title);
        continue;
      }
      if (node.parentTitle && !createdByTitle.has(node.parentTitle)) {
        continue;
      }

      const parentId = node.parentTitle ? createdByTitle.get(node.parentTitle)?.id ?? null : null;
      const startTime = node.startAt ?? seasonStart;
      const endTime = node.endAt ?? endTimeForTitle(node.title);
      const task = await prisma.task.create({
        data: {
          title: node.title,
          description: node.description || descriptionForTitle(node.title),
          parentId,
          points: node.points,
          date: startTime,
          startTime,
          endTime,
          templateId: node.title === rootTitle ? rootTemplateId : null,
          status:
            node.coordinatorAliases.size > 0 ? TaskStatus.TOEGEWEZEN : TaskStatus.BESCHIKBAAR
        },
        select: { id: true }
      });
      createdByTitle.set(node.title, { id: task.id });
      unresolved.delete(title);
      progressed = true;
    }

    if (progressed) {
      continue;
    }

    // Fallback voor ongeldige parent-ketens: hang onder root.
    const fallbackTitle = unresolved.values().next().value as string | undefined;
    if (!fallbackTitle) {
      break;
    }
    const fallbackNode = taskNodesByTitle.get(fallbackTitle);
    if (!fallbackNode) {
      unresolved.delete(fallbackTitle);
      continue;
    }
    fallbackNode.parentTitle = rootTitle;
  }

  const coordinatorLinks: Array<{ taskId: string; userAlias: string }> = [];
  const allCoordinatorAliases = new Set<string>();
  for (const node of taskNodesByTitle.values()) {
    const task = createdByTitle.get(node.title);
    if (!task) {
      continue;
    }
    for (const alias of node.coordinatorAliases) {
      if (!alias) {
        continue;
      }
      coordinatorLinks.push({ taskId: task.id, userAlias: alias });
      allCoordinatorAliases.add(alias);
    }
  }

  if (coordinatorLinks.length > 0) {
    await prisma.taskCoordinator.createMany({
      data: coordinatorLinks,
      skipDuplicates: true
    });
  }

  if (allCoordinatorAliases.size > 0) {
    await prisma.user.updateMany({
      where: {
        alias: { in: Array.from(allCoordinatorAliases) },
        role: UserRole.LID
      },
      data: { role: UserRole.COORDINATOR }
    });
  }
  await prisma.user.update({
    where: { alias: rootOwnerAlias },
    data: { role: UserRole.BESTUUR }
  });
}

async function ensureTemplates() {
  const topTemplate =
    (await prisma.taskTemplate.findFirst({
      where: { title: "Top level Sjabloon", parentTemplateId: null }
    })) ??
    (await prisma.taskTemplate.create({
      data: {
        title: "Top level Sjabloon",
        description: "Root sjabloon voor verenigingstaken"
      }
    }));

  const teamTemplate =
    (await prisma.taskTemplate.findFirst({
      where: { title: "Coachen team", parentTemplateId: topTemplate.id }
    })) ??
    (await prisma.taskTemplate.create({
      data: {
        title: "Coachen team",
        description: "Sjabloon voor taken rond coaching van een team.",
        parentTemplateId: topTemplate.id,
        defaultPoints: 100
      }
    }));

  const defaultTeamSubtemplates = [
    { title: "Teamfoto maken", description: "Maak en verstuur de teamfoto.", defaultPoints: 30 },
    { title: "Rijden", description: "Regel en/of uitvoer van vervoer.", defaultPoints: 20 },
    { title: "Wassen", description: "Wasschema beheren en uitvoeren.", defaultPoints: 15 }
  ];
  for (const subtemplate of defaultTeamSubtemplates) {
    const exists = await prisma.taskTemplate.findFirst({
      where: { title: subtemplate.title, parentTemplateId: teamTemplate.id }
    });
    if (!exists) {
      await prisma.taskTemplate.create({
        data: {
          title: subtemplate.title,
          description: subtemplate.description,
          defaultPoints: subtemplate.defaultPoints,
          parentTemplateId: teamTemplate.id
        }
      });
    }
  }

  return topTemplate.id;
}

async function main() {
  await prisma.magicLinkToken.deleteMany();
  await prisma.openTask.deleteMany();
  await prisma.taskCoordinator.deleteMany();
  await prisma.task.deleteMany();
  await prisma.user.deleteMany();

  await seedUsersFromCsv();
  const rootTemplateId = await ensureTemplates();
  await seedTasksFromCsv(rootTemplateId);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
