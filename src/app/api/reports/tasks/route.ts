import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import {
  isBestuurAlias,
  primaryCoordinatorAlias,
  resolveEffectiveCoordinatorAliases
} from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  status: z.enum(["BESCHIKBAAR", "TOEGEWEZEN", "GEREED"]).optional()
});

function uniqueSortedAliases(aliases: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(aliases).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "nl-NL")
  );
}

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const sessionIsBestuur = await isBestuurAlias(sessionUser.alias);

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige query" }, { status: 400 });
  }

  const where = {
    status: parsed.data.status
  };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { date: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      date: true,
      endTime: true,
      points: true,
      ownCoordinators: {
        select: { userAlias: true }
      }
    }
  });

  const withEffectiveCoordinators = await Promise.all(
    tasks.map(async (task) => {
      const effectiveCoordinatorAliases = await resolveEffectiveCoordinatorAliases(task.id);
      const ownCoordinatorAliases = uniqueSortedAliases(
        task.ownCoordinators.map((item) => item.userAlias)
      );
      const assignedCoordinatorAliases =
        ownCoordinatorAliases.length > 0 ? ownCoordinatorAliases : effectiveCoordinatorAliases;
      const points = Number(task.points);
      const pointsPerCoordinator =
        assignedCoordinatorAliases.length > 0 ? points / assignedCoordinatorAliases.length : 0;

      return {
        id: task.id,
        title: task.title,
        status: task.status,
        date: task.date,
        endTime: task.endTime,
        points: task.points,
        coordinatorAliases: effectiveCoordinatorAliases,
        coordinatorAlias: primaryCoordinatorAlias(assignedCoordinatorAliases),
        pointsPerCoordinator
      };
    })
  );

  const visible = sessionIsBestuur
    ? withEffectiveCoordinators
    : withEffectiveCoordinators.filter((task) =>
        task.coordinatorAliases.includes(sessionUser.alias)
      );

  return NextResponse.json({ data: visible }, { status: 200 });
}
