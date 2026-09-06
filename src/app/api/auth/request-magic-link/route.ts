import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail } from "@/lib/auth-credentials";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { RATE_LIMITS, enforceRateLimits, getClientIp } from "@/lib/rate-limit";
import {
  isRelatiecodeAllowed,
  normalizeInputRelatiecode
} from "@/lib/relatiecodes";

const requestSchema = z.object({
  bondsnummer: z.string().trim().min(2),
  email: z.string().email()
});

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function createQrCodeUrl(value: string): string {
  return `https://quickchart.io/qr?size=320&margin=1&text=${encodeURIComponent(value)}`;
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const bondsnummer = normalizeInputRelatiecode(parsed.data.bondsnummer);
  const email = normalizeEmail(parsed.data.email);

  const rateLimited = enforceRateLimits([
    { key: `magic:ip:${getClientIp(request)}`, rule: RATE_LIMITS.magicLinkPerIp },
    { key: `magic:email:${email}`, rule: RATE_LIMITS.magicLinkPerTarget }
  ]);
  if (rateLimited) {
    return rateLimited;
  }

  if (!(await isRelatiecodeAllowed(bondsnummer))) {
    return NextResponse.json({ error: "Onbekende relatiecode" }, { status: 404 });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

  await prisma.magicLinkToken.create({
    data: {
      email,
      bondsnummer,
      tokenHash,
      expiresAt
    }
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const magicLinkUrl = `${baseUrl}/login?flow=create-account&token=${encodeURIComponent(token)}`;
  const qrCodeUrl = createQrCodeUrl(magicLinkUrl);
  const safeLink = htmlEscape(magicLinkUrl);
  const safeQrCode = htmlEscape(qrCodeUrl);
  const safeBondsnummer = htmlEscape(bondsnummer);

  try {
    await sendMail({
      to: email,
      subject: "Maak je Inzet-account aan",
      text: [
        "Je hebt een accountaanmaak-link aangevraagd voor Inzet.",
        "",
        `Open deze link binnen 20 minuten: ${magicLinkUrl}`,
        `QR-code: ${qrCodeUrl}`,
        "",
        `Relatiecode: ${bondsnummer}`,
        "",
        "Daarna maak je account af met relatiecode, alias (zichtbare naam), loginnaam en wachtwoord.",
        "Let op: gebruik geen persoonsgegevens in loginnaam of alias. Voor herkenbaarheid binnen de club heeft voornaam de voorkeur.",
        "",
        "Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren."
      ].join("\n"),
      html: [
        "<p>Je hebt een accountaanmaak-link aangevraagd voor Inzet.</p>",
        `<p><a href="${safeLink}">Open deze link binnen 20 minuten</a></p>`,
        `<p><img src="${safeQrCode}" alt="QR-code voor accountaanmaak" width="220" height="220" /></p>`,
        `<p><strong>Relatiecode:</strong> ${safeBondsnummer}</p>`,
        "<p>Daarna maak je account af met relatiecode, alias (zichtbare naam), loginnaam en wachtwoord.</p>",
        "<p><strong>Let op:</strong> gebruik geen persoonsgegevens in loginnaam of alias. Voor herkenbaarheid binnen de club heeft voornaam de voorkeur.</p>",
        "<p>Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.</p>"
      ].join("")
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
      message: "Magic link voor accountaanmaak is verstuurd.",
      debugToken: process.env.NODE_ENV === "production" ? undefined : token,
      debugEmail: process.env.NODE_ENV === "production" ? undefined : email,
      debugBondsnummer: process.env.NODE_ENV === "production" ? undefined : bondsnummer,
      debugMagicLink: process.env.NODE_ENV === "production" ? undefined : magicLinkUrl
    },
    { status: 200 }
  );
}
