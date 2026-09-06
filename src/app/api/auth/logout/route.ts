import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/api-session";

export async function POST() {
  const response = NextResponse.json({ message: "Uitgelogd" }, { status: 200 });
  return clearSessionCookie(response);
}
