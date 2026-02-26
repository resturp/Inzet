import { prisma } from "@/lib/prisma";

function normalizeVersionValue(
  value: bigint | number | string | null | undefined
): number {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getCurrentDataVersion(): Promise<number> {
  const result = await prisma.$queryRaw<Array<{ version_ms: bigint | number | string | null }>>`
    SELECT FLOOR(
      EXTRACT(
        EPOCH FROM GREATEST(
          COALESCE((SELECT MAX("createdAt") FROM "Task"), TO_TIMESTAMP(0)),
          COALESCE((SELECT MAX("createdAt") FROM "OpenTask"), TO_TIMESTAMP(0)),
          COALESCE((SELECT MAX("createdAt") FROM "User"), TO_TIMESTAMP(0)),
          COALESCE((SELECT MAX("createdAt") FROM "TaskTemplate"), TO_TIMESTAMP(0)),
          COALESCE((SELECT MAX("createdAt") FROM "AuditLog"), TO_TIMESTAMP(0))
        )
      ) * 1000
    )::BIGINT AS version_ms
  `;

  return normalizeVersionValue(result[0]?.version_ms);
}
