import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

type PasswordCandidate = {
  alias: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function findMatchingEmailPasswordUsers(
  email: string,
  password: string
): Promise<Array<{ alias: string; emailVerifiedAt: Date | null }>> {
  const candidates: PasswordCandidate[] = await prisma.user.findMany({
    where: {
      email: normalizeEmail(email),
      isActive: true,
      passwordHash: { not: null }
    },
    select: {
      alias: true,
      passwordHash: true,
      emailVerifiedAt: true
    }
  });

  const matches: Array<{ alias: string; emailVerifiedAt: Date | null }> = [];
  for (const candidate of candidates) {
    if (!candidate.passwordHash) {
      continue;
    }
    if (await verifyPassword(password, candidate.passwordHash)) {
      matches.push({
        alias: candidate.alias,
        emailVerifiedAt: candidate.emailVerifiedAt
      });
    }
  }
  return matches;
}

export async function findEmailPasswordConflictAlias(
  email: string,
  password: string,
  excludeAlias?: string
): Promise<string | null> {
  const matches = await findMatchingEmailPasswordUsers(email, password);
  const conflict = matches.find((match) => match.alias !== excludeAlias);
  return conflict?.alias ?? null;
}
