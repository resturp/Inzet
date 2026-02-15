import { prisma } from "@/lib/prisma";

export async function writeAuditLog(input: {
  actorAlias: string;
  actionType: string;
  entityType: string;
  entityId: string;
  payload?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      actorAlias: input.actorAlias,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null
    }
  });
}
