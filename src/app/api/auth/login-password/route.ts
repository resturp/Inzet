import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import {
  findMatchingEmailPasswordUsers,
  normalizeEmail
} from "@/lib/auth-credentials";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const matches = await findMatchingEmailPasswordUsers(email, parsed.data.password);
  if (matches.length === 0) {
    return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
  }
  if (matches.length > 1) {
    return NextResponse.json(
      {
        error:
          "Deze e-mail/wachtwoord-combinatie hoort bij meerdere accounts. Kies een ander wachtwoord."
      },
      { status: 409 }
    );
  }

  const user = matches[0];
  if (!user.emailVerifiedAt) {
    return NextResponse.json(
      {
        error: "Je e-mailadres is nog niet bevestigd via de magic link."
      },
      { status: 428 }
    );
  }

  await ensureGovernanceBootstrap(user.alias);

  const response = NextResponse.json(
    { message: "Login geslaagd", alias: user.alias },
    { status: 200 }
  );
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
