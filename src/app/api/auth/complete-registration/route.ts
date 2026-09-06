import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  findConflictingLoginNameAlias,
  isValidLoginName,
  normalizeLoginName
} from "@/lib/auth-credentials";
import { attachSessionCookie } from "@/lib/api-session";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import { hashPassword } from "@/lib/password";
import { readPrecreatedAliases } from "@/lib/precreated-aliases";
import { prisma } from "@/lib/prisma";
import { RATE_LIMITS, enforceRateLimits, getClientIp } from "@/lib/rate-limit";
import { normalizeInputRelatiecode as normalizeRelatiecode } from "@/lib/relatiecodes";

const ALIAS_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_\- .]{1,39}$/u;

const createAccountSchema = z
  .object({
    token: z.string().trim().min(20),
    bondsnummer: z.string().trim().min(2),
    alias: z.string().trim().min(2).max(40).regex(ALIAS_PATTERN),
    loginName: z.string().trim().min(3).max(32),
    password: z.string().min(8)
  });

export async function POST(request: Request) {
  const rateLimited = enforceRateLimits([
    { key: `token:ip:${getClientIp(request)}`, rule: RATE_LIMITS.tokenPerIp }
  ]);
  if (rateLimited) {
    return rateLimited;
  }

  const parsed = createAccountSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const tokenRecord = await prisma.magicLinkToken.findFirst({
    where: {
      tokenHash,
      userAlias: null,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      bondsnummer: true
    }
  });

  if (!tokenRecord || !tokenRecord.email || !tokenRecord.bondsnummer) {
    return NextResponse.json({ error: "Magic link ongeldig of verlopen" }, { status: 401 });
  }

  const email = tokenRecord.email.trim().toLowerCase();
  const bondsnummer = normalizeRelatiecode(parsed.data.bondsnummer);
  if (bondsnummer !== tokenRecord.bondsnummer) {
    return NextResponse.json(
      { error: "Relatiecode komt niet overeen met deze magic link." },
      { status: 400 }
    );
  }

  const targetAlias = parsed.data.alias.trim();
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

  const conflictingAlias = await findConflictingLoginNameAlias(loginName, targetAlias);
  if (conflictingAlias) {
    return NextResponse.json(
      { error: "Deze loginnaam is al in gebruik." },
      { status: 409 }
    );
  }

  // Only aliases the club pre-created (data/alias.csv) may be claimed. Any other existing
  // user row, including seeded placeholders such as "Bestuur", is off limits: claiming one
  // would inherit its task coordinator roles.
  const claimablePrecreatedAlias = (await readPrecreatedAliases()).includes(targetAlias);

  const passwordHash = await hashPassword(parsed.data.password);
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { alias: targetAlias },
        select: {
          alias: true,
          email: true,
          passwordHash: true,
          loginName: true
        }
      });

      if (!existing) {
        await tx.user.create({
          data: {
            alias: targetAlias,
            bondsnummer,
            email,
            emailVerifiedAt: now,
            passwordHash,
            loginName,
            isActive: true
          }
        });
      } else {
        if (
          !claimablePrecreatedAlias ||
          existing.email ||
          existing.passwordHash ||
          existing.loginName
        ) {
          throw new Error("ALIAS_ALREADY_CLAIMED");
        }
        await tx.user.update({
          where: { alias: targetAlias },
          data: {
            bondsnummer,
            email,
            emailVerifiedAt: now,
            passwordHash,
            loginName,
            isActive: true
          }
        });
      }

      const tokenUse = await tx.magicLinkToken.updateMany({
        where: {
          id: tokenRecord.id,
          usedAt: null
        },
        data: { usedAt: now }
      });
      if (tokenUse.count !== 1) {
        throw new Error("TOKEN_USED");
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALIAS_ALREADY_CLAIMED") {
      return NextResponse.json(
        { error: "Deze alias is al in gebruik." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "TOKEN_USED") {
      return NextResponse.json({ error: "Magic link is al gebruikt." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Deze loginnaam is al in gebruik." }, { status: 409 });
    }
    throw error;
  }

  await ensureGovernanceBootstrap(targetAlias);

  const response = NextResponse.json(
    { message: "Account aangemaakt en ingelogd.", alias: targetAlias },
    { status: 200 }
  );
  return attachSessionCookie(response, { alias: targetAlias, passwordHash });
}
