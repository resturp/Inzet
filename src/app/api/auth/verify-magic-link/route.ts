import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureGovernanceBootstrap } from "@/lib/bootstrap-governance";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session";

const verifySchema = z.object({
  alias: z.string().trim().min(1),
  token: z.string().trim().min(20),
  setPassword: z.string().min(8)
});

export async function POST(request: Request) {
  const parsed = verifySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");

  const record = await prisma.magicLinkToken.findFirst({
    where: {
      userAlias: parsed.data.alias,
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  });

  if (!record) {
    return NextResponse.json({ error: "Token ongeldig of verlopen" }, { status: 401 });
  }

  await prisma.magicLinkToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() }
  });

  const passwordHash = await hashPassword(parsed.data.setPassword);
  await prisma.user.update({
    where: { alias: parsed.data.alias },
    data: { passwordHash }
  });

  await ensureGovernanceBootstrap(parsed.data.alias);

  const response = NextResponse.json(
    { message: "Login geslaagd", alias: parsed.data.alias },
    { status: 200 }
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: parsed.data.alias,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/"
  });

  return response;
}
