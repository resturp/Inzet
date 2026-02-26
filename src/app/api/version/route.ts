import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/api-session";
import { getCurrentDataVersion } from "@/lib/data-version";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const version = await getCurrentDataVersion();

  return NextResponse.json({ data: { version } }, { status: 200 });
}
