import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const loginSchema = z.object({
  login: z.string().trim().min(1),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const login = parsed.data.login.trim();
  const isEmailLogin = login.includes("@");

  const user = isEmailLogin
    ? await prisma.user.findUnique({ where: { email: login } })
    : await prisma.user.findUnique({ where: { alias: login } });

  if (!user || !user.isActive || !user.passwordHash) {
    return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
  }

  if (isEmailLogin) {
    if (!user.emailVerifiedAt) {
      return NextResponse.json(
        {
          error: "Je e-mailadres is nog niet bevestigd. Controleer je mailbox voor de magic link.",
          code: "EMAIL_NOT_VERIFIED",
          alias: user.alias
        },
        { status: 428 }
      );
    }
  } else {
    if (!user.email) {
      return NextResponse.json(
        {
          error: "Vul eerst je e-mailadres in en bevestig via magic link.",
          code: "EMAIL_REQUIRED",
          alias: user.alias
        },
        { status: 428 }
      );
    }
    return NextResponse.json(
      {
        error: "Gebruik je e-mailadres om in te loggen.",
        code: "USE_EMAIL_LOGIN",
        alias: user.alias
      },
      { status: 409 }
    );
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
