import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import {
  findMatchingEmailPasswordUsers,
  findUserByLoginNamePassword,
  isValidLoginName,
  normalizeEmail,
  normalizeLoginName
} from "@/lib/auth-credentials";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const loginSchema = z.object({
  loginName: z.string().trim().min(3).max(254),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const rawIdentifier = parsed.data.loginName.trim();
  const isEmailLogin = rawIdentifier.includes("@");

  let userAlias = "";
  let emailVerifiedAt: Date | null = null;

  if (isEmailLogin) {
    const email = normalizeEmail(rawIdentifier);
    const matches = await findMatchingEmailPasswordUsers(email, parsed.data.password);
    if (matches.length === 0) {
      return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
    }
    if (matches.length > 1) {
      return NextResponse.json(
        {
          error:
            "Deze e-mail/wachtwoord-combinatie hoort bij meerdere accounts. Vraag een magic link aan om je account te kiezen."
        },
        { status: 409 }
      );
    }
    const user = await prisma.user.findUnique({
      where: { alias: matches[0].alias },
      select: {
        alias: true,
        loginName: true,
        email: true,
        bondsnummer: true
      }
    });
    if (!user || !user.email) {
      return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
    }
    if (user.loginName) {
      return NextResponse.json(
        {
          error:
            "Inloggen met e-mailadres is uitgeschakeld. Gebruik je loginnaam + wachtwoord."
        },
        { status: 409 }
      );
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

    await prisma.magicLinkToken.create({
      data: {
        userAlias: user.alias,
        email: user.email,
        bondsnummer: user.bondsnummer,
        tokenHash,
        expiresAt
      }
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const magicLinkUrl = `${baseUrl}/login?flow=setup-login-name&alias=${encodeURIComponent(user.alias)}&token=${encodeURIComponent(token)}`;

    try {
      await sendMail({
        to: user.email,
        subject: "Stel je loginnaam in voor Inzet",
        text: [
          "Je logde in met e-mailadres + wachtwoord.",
          "",
          "Voor dit account is een loginnaam verplicht voordat je verder kunt.",
          `Open binnen 20 minuten deze link: ${magicLinkUrl}`,
          "",
          "Daarna kun je normaal inloggen met loginnaam + wachtwoord."
        ].join("\n")
      });
    } catch (error) {
      console.error("Verplichte loginnaam-link verzenden mislukt", error);
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "E-mail met verplichte loginnaam-link kon niet worden verzonden." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        error:
          "Voor dit account is eerst een loginnaam verplicht. We hebben je een link gemaild."
      },
      { status: 428 }
    );
  } else {
    const loginName = normalizeLoginName(rawIdentifier);
    if (!isValidLoginName(loginName)) {
      return NextResponse.json(
        {
          error:
            "Loginnaam moet 3-32 tekens zijn en mag alleen kleine letters, cijfers, punt, _ en - bevatten."
        },
        { status: 400 }
      );
    }

    const user = await findUserByLoginNamePassword(loginName, parsed.data.password);
    if (!user) {
      return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
    }
    userAlias = user.alias;
    emailVerifiedAt = user.emailVerifiedAt;
  }

  if (!emailVerifiedAt) {
    return NextResponse.json(
      {
        error: "Je e-mailadres is nog niet bevestigd via de magic link."
      },
      { status: 428 }
    );
  }

  await ensureGovernanceBootstrap(userAlias);

  const response = NextResponse.json(
    { message: "Login geslaagd", alias: userAlias },
    { status: 200 }
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: userAlias,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/"
  });

  return response;
}
