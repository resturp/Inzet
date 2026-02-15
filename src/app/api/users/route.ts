import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/api-session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { alias: "asc" },
    select: {
      alias: true,
      role: true
    }
  });

  return NextResponse.json({ data: users }, { status: 200 });
}
