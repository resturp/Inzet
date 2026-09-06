import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { attachSessionCookie } from "@/lib/api-session";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { RATE_LIMITS, enforceRateLimits, getClientIp } from "@/lib/rate-limit";

const verifySchema = z.object({
  token: z.string().trim().min(20),
  alias: z.string().trim().min(1).optional(),
  setPassword: z.string().min(8).optional()
});

export async function POST(request: Request) {
  const rateLimited = enforceRateLimits([
    { key: `token:ip:${getClientIp(request)}`, rule: RATE_LIMITS.tokenPerIp }
  ]);
  if (rateLimited) {
    return rateLimited;
  }

  const parsed = verifySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");

  const record = await prisma.magicLinkToken.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!record) {
    return NextResponse.json({ error: "Token ongeldig of verlopen" }, { status: 401 });
  }
  if (record.usedAt) {
    const reusedWithinMs = Date.now() - record.usedAt.getTime();
    if (reusedWithinMs > 15_000) {
      return NextResponse.json({ error: "Magic link is al gebruikt" }, { status: 409 });
    }
  }

  if (!record.userAlias) {
    return NextResponse.json(
      { error: "Gebruik deze magic link op de account-aanmaakflow." },
      { status: 409 }
    );
  }

  const alias = parsed.data.alias ?? record.userAlias;
  if (alias !== record.userAlias) {
    return NextResponse.json({ error: "Token hoort niet bij deze alias." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { alias },
    select: { alias: true, passwordHash: true, email: true }
  });
  if (!user) {
    return NextResponse.json({ error: "Gebruiker niet gevonden" }, { status: 404 });
  }

  if (!parsed.data.setPassword && !user.passwordHash) {
    return NextResponse.json(
      { error: "Wachtwoord instellen is verplicht voor eerste activatie" },
      { status: 400 }
    );
  }

  const passwordHash = parsed.data.setPassword
    ? await hashPassword(parsed.data.setPassword)
    : undefined;

  const now = new Date();
  if (!record.usedAt) {
    await prisma.$transaction([
      prisma.magicLinkToken.update({
        where: { id: record.id },
        data: { usedAt: now }
      }),
      prisma.user.update({
        where: { alias },
        data: {
          email: record.email ?? user.email,
          passwordHash,
          emailVerifiedAt: now
        }
      })
    ]);
  } else {
    await prisma.user.update({
      where: { alias },
      data: {
        email: record.email ?? user.email,
        passwordHash,
        emailVerifiedAt: now
      }
    });
  }

  await ensureGovernanceBootstrap(alias);

  const response = NextResponse.json({ message: "Login geslaagd", alias }, { status: 200 });
  return attachSessionCookie(response, {
    alias,
    passwordHash: passwordHash ?? user.passwordHash
  });
}
