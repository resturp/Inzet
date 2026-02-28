import { NextResponse } from "next/server";
import { NotificationCategory, NotificationDelivery } from "@prisma/client";
import { z } from "zod";
import { getSessionUser } from "@/lib/api-session";
import {
  findEmailPasswordConflictAlias,
  normalizeEmail
} from "@/lib/auth-credentials";
import { isBestuurAlias } from "@/lib/authorization";
import {
  getNotificationSettingsForUser,
  updateNotificationSettingsForUser
} from "@/lib/notifications";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { sanitizeNullableText } from "@/lib/sanitize";

const MAX_ABOUT_ME_LENGTH = 20_000;
const MAX_PROFILE_PHOTO_DATA_LENGTH = 2_800_000;
const notificationDeliverySchema = z.nativeEnum(NotificationDelivery);
const notificationSettingsSchema = z
  .object({
    [NotificationCategory.NEW_PROPOSAL]: notificationDeliverySchema.optional(),
    [NotificationCategory.PROPOSAL_ACCEPTED]: notificationDeliverySchema.optional(),
    [NotificationCategory.TASK_CHANGED_AS_COORDINATOR]: notificationDeliverySchema.optional(),
    [NotificationCategory.TASK_BECAME_AVAILABLE_AS_COORDINATOR]:
      notificationDeliverySchema.optional(),
    [NotificationCategory.SUBTASK_CREATED_IN_SUBSCRIPTION]: notificationDeliverySchema.optional()
  })
  .partial();

const patchAccountSchema = z
  .object({
    email: z.string().email().optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).optional(),
    aboutMe: z.string().max(MAX_ABOUT_ME_LENGTH).nullable().optional(),
    profilePhotoData: z.string().max(MAX_PROFILE_PHOTO_DATA_LENGTH).nullable().optional(),
    notificationSettings: notificationSettingsSchema.optional()
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
  const [bestuur, notificationSettings] = await Promise.all([
    isBestuurAlias(user.alias),
    getNotificationSettingsForUser(user.alias)
  ]);

  return NextResponse.json(
    {
      data: {
        alias: user.alias,
        bondsnummer: user.bondsnummer,
        email: user.email,
        isBestuur: bestuur,
        aboutMe: user.aboutMe,
        profilePhotoData: user.profilePhotoData,
        notificationSettings
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
  const notificationSettingsUpdates = payload.notificationSettings
    ? Object.fromEntries(
        Object.entries(payload.notificationSettings).filter(
          (entry): entry is [NotificationCategory, NotificationDelivery] =>
            entry[1] !== undefined
        )
      )
    : {};
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
    payload.profilePhotoData !== undefined ||
    Object.keys(notificationSettingsUpdates).length > 0;
  if (!hasAnyUpdate) {
    return NextResponse.json({ error: "Geen wijzigingen ontvangen." }, { status: 400 });
  }
  const hasUserUpdate =
    payload.email !== undefined ||
    payload.newPassword !== undefined ||
    payload.aboutMe !== undefined ||
    payload.profilePhotoData !== undefined;

  const passwordHash = payload.newPassword
    ? await hashPassword(payload.newPassword)
    : undefined;

  const updated = hasUserUpdate
    ? await prisma.user.update({
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
      })
    : await prisma.user.findUnique({
        where: { alias: sessionUser.alias },
        select: {
          alias: true,
          bondsnummer: true,
          email: true,
          aboutMe: true,
          profilePhotoData: true
        }
      });
  if (!updated) {
    return NextResponse.json({ error: "Gebruiker niet gevonden." }, { status: 404 });
  }
  if (Object.keys(notificationSettingsUpdates).length > 0) {
    await updateNotificationSettingsForUser(updated.alias, notificationSettingsUpdates);
  }

  const [bestuur, notificationSettings] = await Promise.all([
    isBestuurAlias(updated.alias),
    getNotificationSettingsForUser(updated.alias)
  ]);

  return NextResponse.json(
    { data: { ...updated, isBestuur: bestuur, notificationSettings }, message: "Account opgeslagen." },
    { status: 200 }
  );
}
