import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail } from "@/lib/auth-credentials";
import { readPrecreatedAliases } from "@/lib/precreated-aliases";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  token: z.string().trim().min(20)
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await prisma.magicLinkToken.findFirst({
    where: {
      tokenHash,
      userAlias: null,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" },
    select: {
      email: true,
      bondsnummer: true
    }
  });

  if (!record || !record.email || !record.bondsnummer) {
    return NextResponse.json({ error: "Magic link ongeldig of verlopen" }, { status: 401 });
  }

  const precreatedAliases = await readPrecreatedAliases();

  return NextResponse.json(
    {
      data: {
        email: normalizeEmail(record.email),
        bondsnummer: record.bondsnummer,
        claimableAliases: precreatedAliases
      }
    },
    { status: 200 }
  );
}
