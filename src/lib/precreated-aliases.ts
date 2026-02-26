import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

const PRIMARY_FILE = path.join(process.cwd(), "data", "alias.csv");

function normalizeAliasCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/""/g, "\"").trim();
  }
  return trimmed;
}

async function readFirstExistingFile(): Promise<string> {
  try {
    return await readFile(PRIMARY_FILE, "utf-8");
  } catch {
    return "";
  }
}

function toCsvCell(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export async function readPrecreatedAliases(): Promise<string[]> {
  const raw = await readFirstExistingFile();
  const aliases: string[] = [];
  const seen = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const alias = normalizeAliasCell(line);
    if (!alias || seen.has(alias)) {
      continue;
    }
    seen.add(alias);
    aliases.push(alias);
  }

  return aliases;
}

export async function addPrecreatedAlias(alias: string): Promise<{ added: boolean }> {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) {
    return { added: false };
  }

  const existingAliases = await readPrecreatedAliases();
  if (existingAliases.includes(normalizedAlias)) {
    return { added: false };
  }

  const currentRaw = await readFirstExistingFile();
  const needsLeadingNewline =
    currentRaw.length > 0 && !currentRaw.endsWith("\n") && !currentRaw.endsWith("\r");
  const row = `${toCsvCell(normalizedAlias)}\n`;
  const payload = needsLeadingNewline ? `\n${row}` : row;
  await appendFile(PRIMARY_FILE, payload, "utf-8");

  return { added: true };
}
