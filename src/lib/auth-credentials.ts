import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const LOGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

type LoginCandidate = {
  alias: string;
  loginName: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};

type EmailCandidate = {
  alias: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidLoginName(value: string): boolean {
  return LOGIN_NAME_PATTERN.test(value);
}

export async function findUserByLoginNamePassword(
  loginName: string,
  password: string
): Promise<{
  alias: string;
  loginName: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
} | null> {
  const normalizedLoginName = normalizeLoginName(loginName);
  const candidates: LoginCandidate[] = await prisma.user.findMany({
    where: {
      loginName: normalizedLoginName,
      isActive: true,
      passwordHash: { not: null }
    },
    select: {
      alias: true,
      loginName: true,
      passwordHash: true,
      emailVerifiedAt: true
    }
  });

  for (const candidate of candidates) {
    if (!candidate.passwordHash || !candidate.loginName) {
      continue;
    }
    if (await verifyPassword(password, candidate.passwordHash)) {
      return {
        alias: candidate.alias,
        loginName: candidate.loginName,
        passwordHash: candidate.passwordHash,
        emailVerifiedAt: candidate.emailVerifiedAt
      };
    }
  }
  return null;
}

export async function findConflictingLoginNameAlias(
  loginName: string,
  excludeAlias?: string
): Promise<string | null> {
  const normalizedLoginName = normalizeLoginName(loginName);
  const existing = await prisma.user.findFirst({
    where: {
      loginName: normalizedLoginName,
      ...(excludeAlias ? { alias: { not: excludeAlias } } : {})
    },
    select: { alias: true }
  });
  return existing?.alias ?? null;
}

export async function findMatchingEmailPasswordUsers(
  email: string,
  password: string
): Promise<Array<{ alias: string; emailVerifiedAt: Date | null }>> {
  const candidates: EmailCandidate[] = await prisma.user.findMany({
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
