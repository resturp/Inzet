import { access, readFile } from "node:fs/promises";
import path from "node:path";

const RELATIECODE_FILES = [
  path.join(process.cwd(), "data", "relatienummers.csv"),
  path.join(process.cwd(), "data", "relatiecodes.csv")
] as const;

async function resolveRelatiecodeFilePath(): Promise<string | null> {
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

function normalizeRelatiecode(value: string): string {
  const trimmed = value.trim();
  const unquoted =
    trimmed.startsWith("\"") && trimmed.endsWith("\"")
      ? trimmed.slice(1, -1).replace(/""/g, "\"")
      : trimmed;
  return unquoted.trim().toUpperCase();
}

export async function readAllowedRelatiecodes(): Promise<string[]> {
  try {
    const filePath = await resolveRelatiecodeFilePath();
    if (!filePath) {
      return [];
    }
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split(/\r?\n/);
    const unique = new Set<string>();
    for (const line of lines) {
      const normalized = normalizeRelatiecode(line);
      if (normalized.length > 1) {
        unique.add(normalized);
      }
    }
    return Array.from(unique);
  } catch {
    return [];
  }
}

export async function isRelatiecodeAllowed(relatiecode: string): Promise<boolean> {
  const allowed = await readAllowedRelatiecodes();
  return allowed.includes(normalizeRelatiecode(relatiecode));
}

export function normalizeInputRelatiecode(relatiecode: string): string {
  return normalizeRelatiecode(relatiecode);
}
