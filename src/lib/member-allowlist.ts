import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PRIMARY_FILE = path.join(process.cwd(), "data", "bondsnummers.json");
const FALLBACK_FILE = path.join(process.cwd(), "data", "bondsnummers.example.json");

function normalize(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 1))
  ).sort((a, b) => a.localeCompare(b));
}

async function readArrayFromFile(filePath: string): Promise<string[] | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalize(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return null;
  }
}

export async function readAllowedBondsnummers(): Promise<string[]> {
  const primary = await readArrayFromFile(PRIMARY_FILE);
  if (primary !== null) {
    return primary;
  }
  const fallback = await readArrayFromFile(FALLBACK_FILE);
  return fallback ?? [];
}

export async function isBondsnummerAllowed(bondsnummer: string): Promise<boolean> {
  const allowed = await readAllowedBondsnummers();
  return allowed.includes(bondsnummer);
}

export async function writeAllowedBondsnummers(values: string[]) {
  const normalized = normalize(values);
  await writeFile(PRIMARY_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}
