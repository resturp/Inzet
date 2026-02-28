import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const RELATIECODE_FILES = [
  path.join(process.cwd(), "data", "relatienummers.csv"),
  path.join(process.cwd(), "data", "relatiecodes.csv")
] as const;

async function resolveReadFilePath(): Promise<string | null> {
  for (const candidate of RELATIECODE_FILES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function resolveWriteFilePath(): Promise<string> {
  const existing = await resolveReadFilePath();
  if (existing) {
    return existing;
  }
  return RELATIECODE_FILES[0];
}

function normalize(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length > 1)
    )
  ).sort((a, b) => a.localeCompare(b, "nl-NL"));
}

export async function readAllowedBondsnummers(): Promise<string[]> {
  try {
    const filePath = await resolveReadFilePath();
    if (!filePath) {
      return [];
    }
    const raw = await readFile(filePath, "utf-8");
    return normalize(raw.split(/\r?\n/));
  } catch {
    return [];
  }
}

export async function isBondsnummerAllowed(bondsnummer: string): Promise<boolean> {
  const allowed = await readAllowedBondsnummers();
  return allowed.includes(bondsnummer.trim().toUpperCase());
}

export async function writeAllowedBondsnummers(values: string[]) {
  const normalized = normalize(values);
  const body = normalized.length > 0 ? `${normalized.join("\n")}\n` : "";
  const filePath = await resolveWriteFilePath();
  await writeFile(filePath, body, "utf-8");
}
