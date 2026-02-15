import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const loginSchema = z.object({
  alias: z.string().trim().min(1),
  password: z.string().min(8)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { alias: parsed.data.alias } });
  if (!user || !user.isActive || !user.passwordHash) {
    return NextResponse.json({ error: "Alias of wachtwoord is onjuist" }, { status: 401 });
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Alias of wachtwoord is onjuist" }, { status: 401 });
  }

  await ensureGovernanceBootstrap(user.alias);

  const response = NextResponse.json({ message: "Login geslaagd", alias: user.alias }, { status: 200 });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: user.alias,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/"
  });

  return response;
}
