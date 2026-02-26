import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getSessionUser } from "@/lib/api-session";
import {
  isRootOwner,
  resolveBestuurAliases,
  resolveEffectiveCoordinatorAliases
} from "@/lib/authorization";
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
  const bestuurAliases = new Set(await resolveBestuurAliases());
  const activeBestuurAlias =
    users
      .filter((user) => user.isActive && bestuurAliases.has(user.alias))
      .map((user) => user.alias)
      .sort((left, right) => left.localeCompare(right, "nl-NL"))[0] ?? null;

  const existingByBondsnummer = new Map<string, typeof users>();
  for (const user of users) {
    const group = existingByBondsnummer.get(user.bondsnummer) ?? [];
    group.push(user);
    existingByBondsnummer.set(user.bondsnummer, group);
  }
  const addedToAllowlist: string[] = [];
  const activated: string[] = [];
  const deactivated: string[] = [];
  const reassignedTasks: string[] = [];

  for (const bondsnummer of desired) {
    const existingUsers = existingByBondsnummer.get(bondsnummer) ?? [];
    if (existingUsers.length === 0) {
      addedToAllowlist.push(bondsnummer);
      continue;
    }

    for (const existing of existingUsers) {
      if (existing.isActive) {
        continue;
      }
      await prisma.user.update({
        where: { alias: existing.alias },
        data: { isActive: true }
      });
      activated.push(existing.alias);
    }
  }

  for (const user of users) {
    if (bestuurAliases.has(user.alias)) {
      continue;
    }
    if (desired.has(user.bondsnummer) || !user.isActive) {
      continue;
    }

    const ownedTaskIds = Array.from(
      new Set(
        (
          await prisma.taskCoordinator.findMany({
            where: { userAlias: user.alias },
            select: { taskId: true }
          })
        ).map((item) => item.taskId)
      )
    );

    for (const taskId of ownedTaskIds) {
      await prisma.taskCoordinator.deleteMany({
        where: {
          taskId,
          userAlias: user.alias
        }
      });

      const effectiveAfterRemoval = await resolveEffectiveCoordinatorAliases(taskId);
      if (effectiveAfterRemoval.length === 0) {
        await prisma.taskCoordinator.create({
          data: {
            taskId,
            userAlias: activeBestuurAlias ?? sessionUser.alias
          }
        });
      }

      reassignedTasks.push(taskId);
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
