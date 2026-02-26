import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import {
  findEmailPasswordConflictAlias,
  normalizeEmail
} from "@/lib/auth-credentials";
import { isBestuurAlias } from "@/lib/authorization";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { sanitizeNullableText } from "@/lib/sanitize";

const MAX_ABOUT_ME_LENGTH = 20_000;
const MAX_PROFILE_PHOTO_DATA_LENGTH = 2_800_000;

const patchAccountSchema = z
  .object({
    email: z.string().email().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).optional(),
    aboutMe: z.string().max(MAX_ABOUT_ME_LENGTH).nullable().optional(),
    profilePhotoData: z.string().max(MAX_PROFILE_PHOTO_DATA_LENGTH).nullable().optional()
  })
  .refine(
    (payload) => {
      if (payload.newPassword && !payload.currentPassword) {
        return false;
      }
      return true;
    },
    {
      message: "Huidig wachtwoord is verplicht voor wachtwoordwijziging",
      path: ["currentPassword"]
    }
  );

function normalizeNullableRawText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function isSupportedImageDataUrl(value: string): boolean {
  return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-zA-Z0-9+/=\n\r]+$/.test(
    value
  );
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const bestuur = await isBestuurAlias(user.alias);

  return NextResponse.json(
    {
      data: {
        alias: user.alias,
        bondsnummer: user.bondsnummer,
        email: user.email,
        isBestuur: bestuur,
        aboutMe: user.aboutMe,
        profilePhotoData: user.profilePhotoData
      }
    },
    { status: 200 }
  );
}

export async function PATCH(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const parsed = patchAccountSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige invoer" }, { status: 400 });
  }

  const payload = parsed.data;
  const normalizedEmail = payload.email === undefined ? undefined : normalizeEmail(payload.email);
  const wantsEmailChange =
    normalizedEmail !== undefined &&
    normalizedEmail !== normalizeEmail(sessionUser.email ?? "");
  const wantsPasswordChange = payload.newPassword !== undefined;
  const wantsSensitiveChange = wantsEmailChange || wantsPasswordChange;

  if (wantsSensitiveChange) {
    if (!sessionUser.passwordHash) {
      return NextResponse.json(
        { error: "Wachtwoordwijziging niet mogelijk zonder bestaand wachtwoord." },
        { status: 409 }
      );
    }
    if (!payload.currentPassword) {
      return NextResponse.json(
        { error: "Huidig wachtwoord is verplicht voor e-mail- of wachtwoordwijziging." },
        { status: 400 }
      );
    }
    const passwordOk = await verifyPassword(payload.currentPassword, sessionUser.passwordHash);
    if (!passwordOk) {
      return NextResponse.json({ error: "Huidig wachtwoord is onjuist." }, { status: 401 });
    }
  }

  const resultingEmail =
    normalizedEmail === undefined ? (sessionUser.email ?? null) : normalizedEmail;
  const passwordCandidate = payload.newPassword ?? payload.currentPassword;
  if (wantsSensitiveChange && resultingEmail && passwordCandidate) {
    const conflictAlias = await findEmailPasswordConflictAlias(
      resultingEmail,
      passwordCandidate,
      sessionUser.alias
    );
    if (conflictAlias) {
      return NextResponse.json(
        {
          error:
            "De combinatie e-mailadres + wachtwoord is al in gebruik. Kies een ander wachtwoord."
        },
        { status: 409 }
      );
    }
  }

  const normalizedPhotoData = payload.profilePhotoData;
  if (
    normalizedPhotoData !== undefined &&
    normalizedPhotoData !== null &&
    !isSupportedImageDataUrl(normalizedPhotoData)
  ) {
    return NextResponse.json(
      { error: "Gebruik een geldige afbeelding (png/jpg/gif/webp/svg)." },
      { status: 400 }
    );
  }

  const hasAnyUpdate =
    payload.email !== undefined ||
    payload.newPassword !== undefined ||
    payload.aboutMe !== undefined ||
    payload.profilePhotoData !== undefined;
  if (!hasAnyUpdate) {
    return NextResponse.json({ error: "Geen wijzigingen ontvangen." }, { status: 400 });
  }

  const passwordHash = payload.newPassword
    ? await hashPassword(payload.newPassword)
    : undefined;

  const updated = await prisma.user.update({
    where: { alias: sessionUser.alias },
    data: {
      email: normalizedEmail === undefined ? undefined : normalizedEmail,
      passwordHash,
      aboutMe: sanitizeNullableText(payload.aboutMe),
      profilePhotoData:
        payload.profilePhotoData === undefined
          ? undefined
          : normalizeNullableRawText(payload.profilePhotoData)
    },
    select: {
      alias: true,
      bondsnummer: true,
      email: true,
      aboutMe: true,
      profilePhotoData: true
    }
  });
  const bestuur = await isBestuurAlias(updated.alias);

  return NextResponse.json(
    { data: { ...updated, isBestuur: bestuur }, message: "Account opgeslagen." },
    { status: 200 }
  );
}
