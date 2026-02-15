import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import { resolveEffectiveCoordinatorAlias } from "@/lib/authorization";
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

  const withEffectiveCoordinator = await Promise.all(
    tasks.map(async (task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      date: task.date,
      endTime: task.endTime,
      points: task.points,
      coordinatorAlias: await resolveEffectiveCoordinatorAlias(task.id)
    }))
  );

  const visible =
    sessionUser.role === UserRole.BESTUUR
      ? withEffectiveCoordinator
      : withEffectiveCoordinator.filter(
          (task) => task.coordinatorAlias === sessionUser.alias
        );

  return NextResponse.json({ data: visible }, { status: 200 });
}
