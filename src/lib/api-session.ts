import { cookies } from "next/headers";
import { flushDueNotificationDigests } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session";

export async function getSessionAlias(): Promise<string | null> {
  const cookieStore = await cookies();
  const alias = cookieStore.get(SESSION_COOKIE_NAME)?.value?.trim();
  return alias && alias.length > 0 ? alias : null;
}

export async function getSessionUser() {
  const alias = await getSessionAlias();
  if (!alias) {
    return null;
  }
  const user = await prisma.user.findUnique({ where: { alias } });
  if (!user || !user.isActive) {
    return null;
  }
  void flushDueNotificationDigests({ userAliases: [alias] }).catch((error) => {
    console.error("Failed to flush due notification digests", { alias, error });
  });
  return user;
}
