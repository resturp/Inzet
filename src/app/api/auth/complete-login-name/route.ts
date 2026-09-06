import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import {
  findConflictingLoginNameAlias,
  isValidLoginName,
  normalizeLoginName
} from "@/lib/auth-credentials";
import { attachSessionCookie } from "@/lib/api-session";
import { prisma } from "@/lib/prisma";
import { RATE_LIMITS, enforceRateLimits, getClientIp } from "@/lib/rate-limit";

const setupSchema = z.object({
  token: z.string().trim().min(20),
  alias: z.string().trim().min(1),
  loginName: z.string().trim().min(3).max(32)
});

export async function POST(request: Request) {
  const rateLimited = enforceRateLimits([
    { key: `token:ip:${getClientIp(request)}`, rule: RATE_LIMITS.tokenPerIp }
  ]);
  if (rateLimited) {
    return rateLimited;
  }

  const parsed = setupSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const loginName = normalizeLoginName(parsed.data.loginName);
  if (!isValidLoginName(loginName)) {
    return NextResponse.json(
      {
        error:
          "Loginnaam moet 3-32 tekens zijn en mag alleen kleine letters, cijfers, punt, _ en - bevatten."
      },
      { status: 400 }
    );
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await prisma.magicLinkToken.findFirst({
    where: {
      tokenHash,
      userAlias: parsed.data.alias,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  });
  if (!record || !record.userAlias) {
    return NextResponse.json({ error: "Magic link ongeldig of verlopen" }, { status: 401 });
  }

  const conflictAlias = await findConflictingLoginNameAlias(loginName, record.userAlias);
  if (conflictAlias) {
    return NextResponse.json({ error: "Deze loginnaam is al in gebruik." }, { status: 409 });
  }

  const user = await prisma.user.findUnique({
    where: { alias: record.userAlias },
    select: {
      alias: true,
      loginName: true,
      email: true,
      passwordHash: true
    }
  });
  if (!user) {
    return NextResponse.json({ error: "Gebruiker niet gevonden" }, { status: 404 });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.magicLinkToken.update({
      where: { id: record.id },
      data: { usedAt: now }
    }),
    prisma.user.update({
      where: { alias: user.alias },
      data: {
        loginName,
        email: record.email ?? user.email,
        emailVerifiedAt: now
      }
    })
  ]);

  await ensureGovernanceBootstrap(user.alias);

  const response = NextResponse.json(
    { message: "Loginnaam ingesteld. Je bent ingelogd.", alias: user.alias },
    { status: 200 }
  );
  return attachSessionCookie(response, { alias: user.alias, passwordHash: user.passwordHash });
}
