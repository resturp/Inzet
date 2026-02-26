import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { findEmailPasswordConflictAlias } from "@/lib/auth-credentials";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import { hashPassword } from "@/lib/password";
import { readPrecreatedAliases } from "@/lib/precreated-aliases";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const createAccountSchema = z
  .object({
    token: z.string().trim().min(20),
    existingAlias: z.string().trim().min(1).optional(),
    newAlias: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{3,32}$/)
      .optional(),
    password: z.string().min(8)
  })
  .refine(
    (data) => {
      const hasExistingAlias = Boolean(data.existingAlias);
      const hasNewAlias = Boolean(data.newAlias);
      return (hasExistingAlias || hasNewAlias) && !(hasExistingAlias && hasNewAlias);
    },
    {
      message: "Kies een bestaande alias of vul een nieuwe alias in.",
      path: ["existingAlias"]
    }
  );

export async function POST(request: Request) {
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
  const bondsnummer = tokenRecord.bondsnummer;
  const existingAlias = parsed.data.existingAlias?.trim();
  const newAlias = parsed.data.newAlias?.trim();

  let targetAlias = "";
  if (existingAlias) {
    targetAlias = existingAlias;
  } else if (newAlias) {
    const aliasTaken = await prisma.user.findUnique({ where: { alias: newAlias } });
    if (aliasTaken) {
      return NextResponse.json({ error: "Alias is al in gebruik." }, { status: 409 });
    }
    targetAlias = newAlias;
  }

  const conflictingAlias = await findEmailPasswordConflictAlias(
    email,
    parsed.data.password,
    existingAlias ?? undefined
  );
  if (conflictingAlias) {
    return NextResponse.json(
      {
        error:
          "De combinatie e-mailadres + wachtwoord is al in gebruik. Kies een ander wachtwoord."
      },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      if (existingAlias) {
        const knownAliases = await readPrecreatedAliases();
        if (!knownAliases.includes(targetAlias)) {
          throw new Error("ALIAS_UNKNOWN");
        }

        const existing = await tx.user.findUnique({
          where: { alias: targetAlias },
          select: { alias: true, email: true, passwordHash: true }
        });
        if (!existing) {
          await tx.user.create({
            data: {
              alias: targetAlias,
              bondsnummer,
              email,
              emailVerifiedAt: now,
              passwordHash,
              isActive: true
            }
          });
        } else {
          if (existing.email || existing.passwordHash) {
            throw new Error("ALIAS_ALREADY_CLAIMED");
          }
          await tx.user.update({
            where: { alias: targetAlias },
            data: {
              bondsnummer,
              email,
              emailVerifiedAt: now,
              passwordHash,
              isActive: true
            }
          });
        }
      } else {
        await tx.user.create({
          data: {
            alias: targetAlias,
            bondsnummer,
            email,
            emailVerifiedAt: now,
            passwordHash,
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
    if (error instanceof Error && error.message === "ALIAS_UNKNOWN") {
      return NextResponse.json(
        { error: "Deze alias staat niet in de bestaande aliaslijst." },
        { status: 404 }
      );
    }
    if (error instanceof Error && error.message === "ALIAS_ALREADY_CLAIMED") {
      return NextResponse.json(
        { error: "Deze bestaande alias is al geclaimd." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "TOKEN_USED") {
      return NextResponse.json({ error: "Magic link is al gebruikt." }, { status: 409 });
    }
    throw error;
  }

  await ensureGovernanceBootstrap(targetAlias);

  const response = NextResponse.json(
    { message: "Account aangemaakt en ingelogd.", alias: targetAlias },
    { status: 200 }
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: targetAlias,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/"
  });

  return response;
}
