import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail } from "@/lib/auth-credentials";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import {
  isRelatiecodeAllowed,
  normalizeInputRelatiecode
} from "@/lib/relatiecodes";

const requestSchema = z.object({
  bondsnummer: z.string().trim().min(2),
  email: z.string().email(),
  alias: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{3,32}$/)
    .optional()
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const bondsnummer = normalizeInputRelatiecode(parsed.data.bondsnummer);
  const email = normalizeEmail(parsed.data.email);
  const requestedAlias = parsed.data.alias?.trim();

  if (!(await isRelatiecodeAllowed(bondsnummer))) {
    return NextResponse.json({ error: "Onbekende relatiecode" }, { status: 404 });
  }

  let aliasUser: { alias: string } | null = null;
  if (requestedAlias) {
    aliasUser = await prisma.user.findFirst({
      where: {
        alias: requestedAlias,
        bondsnummer,
        isActive: true
      },
      select: { alias: true }
    });
    if (!aliasUser) {
      return NextResponse.json(
        { error: "Alias hoort niet bij deze relatiecode of is inactief." },
        { status: 404 }
      );
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

  await prisma.magicLinkToken.create({
    data: {
      userAlias: aliasUser?.alias,
      email,
      bondsnummer,
      tokenHash,
      expiresAt
    }
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const magicLinkUrl = aliasUser
    ? `${baseUrl}/login?flow=magic&alias=${encodeURIComponent(aliasUser.alias)}&token=${encodeURIComponent(token)}`
    : `${baseUrl}/login?flow=create-account&token=${encodeURIComponent(token)}`;

  try {
    await sendMail({
      to: email,
      subject: aliasUser ? "Je Inzet magic link" : "Maak je Inzet-account aan",
      text: aliasUser
        ? [
            "Je hebt een loginlink aangevraagd voor Inzet.",
            "",
            `Open deze link binnen 20 minuten: ${magicLinkUrl}`,
            "",
            `Alias: ${aliasUser.alias}`,
            "",
            "Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren."
          ].join("\n")
        : [
            "Je hebt een accountaanmaak-link aangevraagd voor Inzet.",
            "",
            `Open deze link binnen 20 minuten: ${magicLinkUrl}`,
            "",
            "Op de pagina kies je een bestaande alias of verzin je een nieuwe alias.",
            "Daarna stel je een wachtwoord in en kun je meteen inloggen."
          ].join("\n")
    });
  } catch (error) {
    console.error("Magic link e-mail verzenden mislukt", error);
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Magic link kon niet per e-mail worden verzonden. Probeer opnieuw." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      message: aliasUser
        ? "Magic link om in te loggen is verstuurd."
        : "Magic link voor accountaanmaak is verstuurd.",
      debugToken: process.env.NODE_ENV === "production" ? undefined : token,
      debugAlias: process.env.NODE_ENV === "production" ? undefined : aliasUser?.alias,
      debugEmail: process.env.NODE_ENV === "production" ? undefined : email,
      debugBondsnummer: process.env.NODE_ENV === "production" ? undefined : bondsnummer,
      debugMagicLink: process.env.NODE_ENV === "production" ? undefined : magicLinkUrl
    },
    { status: 200 }
  );
}
