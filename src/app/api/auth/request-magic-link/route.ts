import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isBondsnummerAllowed } from "@/lib/member-allowlist";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";

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

  const { bondsnummer, email } = parsed.data;
  const requestedAlias = parsed.data.alias?.trim();

  let user = await prisma.user.findUnique({ where: { bondsnummer } });

  if (user && !user.isActive) {
    return NextResponse.json({ error: "Onbekend of inactief bondsnummer" }, { status: 404 });
  }

  if (!user) {
    const allowed = await isBondsnummerAllowed(bondsnummer);
    if (!allowed) {
      return NextResponse.json({ error: "Onbekend of inactief bondsnummer" }, { status: 404 });
    }
    if (!requestedAlias) {
      return NextResponse.json(
        { error: "Alias is verplicht bij eerste accountaanmaak" },
        { status: 400 }
      );
    }

    const aliasInUse = await prisma.user.findUnique({ where: { alias: requestedAlias } });
    if (aliasInUse) {
      return NextResponse.json({ error: "Alias is al in gebruik" }, { status: 409 });
    }

    user = await prisma.user.create({
      data: {
        alias: requestedAlias,
        bondsnummer,
        email,
        role: UserRole.LID,
        isActive: true
      }
    });
  } else if (requestedAlias && requestedAlias !== user.alias) {
    const aliasInUse = await prisma.user.findUnique({ where: { alias: requestedAlias } });
    if (aliasInUse && aliasInUse.bondsnummer !== bondsnummer) {
      return NextResponse.json({ error: "Alias is al in gebruik" }, { status: 409 });
    }

    user = await prisma.user.update({
      where: { alias: user.alias },
      data: {
        alias: requestedAlias,
        email
      }
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

  await prisma.$transaction([
    prisma.user.update({
      where: { alias: user.alias },
      data: { email }
    }),
    prisma.magicLinkToken.create({
      data: {
        userAlias: user.alias,
        tokenHash,
        expiresAt
      }
    })
  ]);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const magicLinkUrl = `${baseUrl}/login?alias=${encodeURIComponent(user.alias)}&token=${encodeURIComponent(token)}`;

  try {
    await sendMail({
      to: email,
      subject: "Je Inzet magic link",
      text: [
        "Je hebt een loginlink aangevraagd voor Inzet.",
        "",
        `Open deze link binnen 20 minuten: ${magicLinkUrl}`,
        "",
        `Alias: ${user.alias}`,
        "",
        "Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren."
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
      message: "Magic link is aangemaakt en wordt per e-mail verstuurd.",
      debugToken: process.env.NODE_ENV === "production" ? undefined : token,
      debugAlias: process.env.NODE_ENV === "production" ? undefined : user.alias,
      debugMagicLink: process.env.NODE_ENV === "production" ? undefined : magicLinkUrl
    },
    { status: 200 }
  );
}
