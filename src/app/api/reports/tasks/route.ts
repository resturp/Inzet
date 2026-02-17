import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import { primaryCoordinatorAlias, resolveEffectiveCoordinatorAliases } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  status: z.enum(["BESCHIKBAAR", "TOEGEWEZEN", "GEREED"]).optional()
});

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

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
      points: true
    }
  });

  const withEffectiveCoordinators = await Promise.all(
    tasks.map(async (task) => {
      const coordinatorAliases = await resolveEffectiveCoordinatorAliases(task.id);
      const points = Number(task.points.toString());
      const pointsPerCoordinator =
        coordinatorAliases.length > 0 ? points / coordinatorAliases.length : 0;

      return {
        id: task.id,
        title: task.title,
        status: task.status,
        date: task.date,
        endTime: task.endTime,
        points: task.points,
        coordinatorAliases,
        coordinatorAlias: primaryCoordinatorAlias(coordinatorAliases),
        pointsPerCoordinator
      };
    })
  );

  const visible =
    sessionUser.role === UserRole.BESTUUR
      ? withEffectiveCoordinators
      : withEffectiveCoordinators.filter((task) =>
          task.coordinatorAliases.includes(sessionUser.alias)
        );

  return NextResponse.json({ data: visible }, { status: 200 });
}
