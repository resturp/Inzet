import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import { isRootOwner, resolveEffectiveCoordinatorAlias } from "@/lib/authorization";
import { writeAllowedBondsnummers } from "@/lib/member-allowlist";
import { prisma } from "@/lib/prisma";

const syncSchema = z.object({
  bondsnummers: z.array(z.string().trim().min(2)).min(1)
});

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const parsed = syncSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  if (!(await isRootOwner(sessionUser.alias))) {
    return NextResponse.json(
      { error: "Alleen de eigenaar van de root-taak mag leden synchroniseren" },
      { status: 403 }
    );
  }

  const desired = new Set(parsed.data.bondsnummers);
  await writeAllowedBondsnummers(Array.from(desired));

  const users = await prisma.user.findMany();
  const activeBestuur = await prisma.user.findFirst({
    where: { role: UserRole.BESTUUR, isActive: true },
    orderBy: { createdAt: "asc" }
  });

  const existingByBondsnummer = new Map(users.map((user) => [user.bondsnummer, user]));
  const addedToAllowlist: string[] = [];
  const activated: string[] = [];
  const deactivated: string[] = [];
  const reassignedTasks: string[] = [];

  async function resolveFallbackCoordinatorForParent(
    parentId: string | null,
    aliasBeingRemoved: string,
    defaultAlias: string
  ): Promise<string> {
    if (!parentId) {
      return defaultAlias;
    }
    const parentEffective = await resolveEffectiveCoordinatorAlias(parentId);
    if (parentEffective && parentEffective !== aliasBeingRemoved) {
      return parentEffective;
    }
    return defaultAlias;
  }

  for (const bondsnummer of desired) {
    const existing = existingByBondsnummer.get(bondsnummer);
    if (!existing) {
      addedToAllowlist.push(bondsnummer);
      continue;
    }

    if (!existing.isActive) {
      await prisma.user.update({
        where: { alias: existing.alias },
        data: { isActive: true }
      });
      activated.push(existing.alias);
    }
  }

  for (const user of users) {
    if (user.role === UserRole.BESTUUR) {
      continue;
    }
    if (desired.has(user.bondsnummer) || !user.isActive) {
      continue;
    }

    const ownedTasks = await prisma.task.findMany({
      where: { ownCoordinatorAlias: user.alias },
      select: { id: true, parentId: true }
    });

    for (const task of ownedTasks) {
      const fallbackCoordinator = await resolveFallbackCoordinatorForParent(
        task.parentId,
        user.alias,
        activeBestuur?.alias ?? sessionUser.alias
      );

      await prisma.task.update({
        where: { id: task.id },
        data: { ownCoordinatorAlias: fallbackCoordinator }
      });
      reassignedTasks.push(task.id);
    }

    await prisma.user.update({
      where: { alias: user.alias },
      data: { isActive: false }
    });
    deactivated.push(user.alias);
  }

  await writeAuditLog({
    actorAlias: sessionUser.alias,
    actionType: "MEMBERS_SYNC",
    entityType: "User",
    entityId: sessionUser.alias,
    payload: {
      addedToAllowlist,
      activated,
      deactivated,
      reassignedTasksCount: reassignedTasks.length
    }
  });

  return NextResponse.json(
    {
      message: "Ledenbestand bijgewerkt",
      summary: {
        addedToAllowlistCount: addedToAllowlist.length,
        activatedCount: activated.length,
        deactivatedCount: deactivated.length,
        reassignedTasksCount: reassignedTasks.length
      }
    },
    { status: 200 }
  );
}
