import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

type CsvUser = {
  alias: string;
  bondsnummer: string | null;
  password: string | null;
  email: string | null;
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

function toSafeIdFragment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 20) : "user";
}

function pendingBondsnummer(alias: string, index: number): string {
  return `PENDING-${toSafeIdFragment(alias)}-${String(index + 1).padStart(3, "0")}`;
}

function parseAliasCsv(raw: string): CsvUser[] {
  const rows = parseCsvRows(raw);
  const users: CsvUser[] = [];

  for (const row of rows) {
    const alias = (row[0] ?? "").trim();
    if (!alias) {
      continue;
    }
    const passwordRaw = (row[1] ?? "").trim();
    const emailRaw = (row[2] ?? "").trim().toLowerCase();
    const bondsnummerRaw = (row[3] ?? "").trim().toUpperCase();

    users.push({
      alias,
      password: passwordRaw.length > 0 ? passwordRaw : null,
      email: emailRaw.length > 0 ? emailRaw : null,
      bondsnummer: bondsnummerRaw.length > 0 ? bondsnummerRaw : null
    });
  }

  return users;
}

async function main() {
  const csvPath = path.join(process.cwd(), "data", "alias.csv");
  const raw = await fs.readFile(csvPath, "utf8");
  const csvUsers = parseAliasCsv(raw);

  let added = 0;
  let skipped = 0;

  for (let index = 0; index < csvUsers.length; index += 1) {
    const user = csvUsers[index];
    const existing = await prisma.user.findUnique({ where: { alias: user.alias } });
    if (existing) {
      skipped += 1;
      continue;
    }

    const passwordHash = user.password ? await hashPassword(user.password) : null;
    await prisma.user.create({
      data: {
        alias: user.alias,
        bondsnummer: user.bondsnummer ?? pendingBondsnummer(user.alias, index),
        role: UserRole.LID,
        isActive: true,
        passwordHash,
        email: user.email,
        emailVerifiedAt: user.email && user.password ? new Date() : null
      }
    });
    added += 1;
    console.log(`Toegevoegd: ${user.alias}`);
  }

  console.log(`\nKlaar. ${added} nieuwe alias(sen) toegevoegd, ${skipped} bestonden al en zijn overgeslagen.`);
  console.log("Bestaande users, taken en coordinators zijn niet aangeraakt.");
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
