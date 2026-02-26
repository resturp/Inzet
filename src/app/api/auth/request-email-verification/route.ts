import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail } from "@/lib/auth-credentials";
import { sendMail } from "@/lib/mailer";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const requestSchema = z.object({
  alias: z.string().trim().min(1),
  password: z.string().min(1),
  email: z.string().email()
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const alias = parsed.data.alias.trim();
  const email = normalizeEmail(parsed.data.email);

  const user = await prisma.user.findUnique({ where: { alias } });
  if (!user || !user.isActive || !user.passwordHash) {
    return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
  }

  const passwordOk = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Inloggegevens zijn onjuist" }, { status: 401 });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

  await prisma.magicLinkToken.create({
    data: {
      userAlias: alias,
      email,
      bondsnummer: user.bondsnummer,
      tokenHash,
      expiresAt
    }
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const magicLinkUrl = `${baseUrl}/login?flow=magic&alias=${encodeURIComponent(alias)}&token=${encodeURIComponent(token)}`;

  try {
    await sendMail({
      to: email,
      subject: "Bevestig je e-mailadres voor Inzet",
      text: [
        "Je hebt een e-mailadres gekoppeld aan je Inzet-account.",
        "",
        `Bevestig binnen 20 minuten via: ${magicLinkUrl}`,
        "",
        `Alias: ${alias}`,
        "",
        "Na bevestiging log je in met e-mailadres + wachtwoord."
      ].join("\n")
    });
  } catch (error) {
    console.error("Verificatiemail verzenden mislukt", error);
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Verificatiemail kon niet worden verzonden. Probeer opnieuw." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      message: "Controleer je mailbox en bevestig je e-mailadres met de magic link.",
      debugAlias: process.env.NODE_ENV === "production" ? undefined : alias,
      debugToken: process.env.NODE_ENV === "production" ? undefined : token,
      debugMagicLink: process.env.NODE_ENV === "production" ? undefined : magicLinkUrl
    },
    { status: 200 }
  );
}
