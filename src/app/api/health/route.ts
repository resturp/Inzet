import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Database health timeout")), 3000);
      })
    ]);
  } catch {
    return NextResponse.json(
      { ok: false, service: "inzet-vrijwilligersportaal", database: "unavailable" },
      { status: 503 }
    );
  } finally {
    clearTimeout(timeout);
  }

  return NextResponse.json(
    {
      ok: true,
      service: "inzet-vrijwilligersportaal",
      timestamp: new Date().toISOString()
    },
    { status: 200 }
  );
}
