import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const RELATIECODES_FILE = path.join(process.cwd(), "data", "relatiecodes.csv");

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
    const raw = await readFile(RELATIECODES_FILE, "utf-8");
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
  await writeFile(RELATIECODES_FILE, body, "utf-8");
}
