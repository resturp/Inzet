import assert from "node:assert/strict";
import test from "node:test";
import { NotificationCategory, NotificationDelivery } from "@prisma/client";
import { flushDueNotificationDigests } from "../src/lib/notifications";
import { prisma } from "../src/lib/prisma";

test("hourly digest bundelt categorieen per gebruiker in een batch", async () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const oldDigestMoment = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const userAlias = "isaura";

  const preferences = [
    {
      userAlias,
      category: NotificationCategory.NEW_PROPOSAL,
      delivery: NotificationDelivery.HOURLY,
      lastDigestSentAt: oldDigestMoment,
      user: {
        alias: userAlias,
        email: "isaura@example.com",
        isActive: true
      }
    },
    {
      userAlias,
      category: NotificationCategory.PROPOSAL_ACCEPTED,
      delivery: NotificationDelivery.HOURLY,
      lastDigestSentAt: oldDigestMoment,
      user: {
        alias: userAlias,
        email: "isaura@example.com",
        isActive: true
      }
    }
  ];

  const pendingByCategory: Record<NotificationCategory, Array<{
    id: string;
    category: NotificationCategory;
    subject: string;
    body: string;
    createdAt: Date;
  }>> = {
    [NotificationCategory.NEW_PROPOSAL]: [
      {
        id: "evt-new-proposal",
        category: NotificationCategory.NEW_PROPOSAL,
        subject: "Nieuw voorstel",
        body: "Voorstel A",
        createdAt: new Date(now.getTime() - 90 * 60 * 1000)
      }
    ],
    [NotificationCategory.PROPOSAL_ACCEPTED]: [
      {
        id: "evt-proposal-accepted",
        category: NotificationCategory.PROPOSAL_ACCEPTED,
        subject: "Voorstel geaccepteerd",
        body: "Voorstel B",
        createdAt: new Date(now.getTime() - 80 * 60 * 1000)
      }
    ],
    [NotificationCategory.TASK_CHANGED_AS_COORDINATOR]: [],
    [NotificationCategory.TASK_BECAME_AVAILABLE_AS_COORDINATOR]: [],
    [NotificationCategory.SUBTASK_CREATED_IN_SUBSCRIPTION]: []
  };

  const originalPreferenceFindMany = prisma.notificationPreference.findMany;
  const originalEventFindMany = prisma.notificationEvent.findMany;
  const originalEventUpdateMany = prisma.notificationEvent.updateMany;
  const originalPreferenceUpdate = prisma.notificationPreference.update;
  const originalTransaction = prisma.$transaction;

  const eventUpdateManyArgs: unknown[] = [];
  const preferenceUpdateArgs: unknown[] = [];
  const transactionOperationCounts: number[] = [];

  try {
    (prisma.notificationPreference.findMany as unknown as (...args: unknown[]) => unknown) =
      async () => preferences;
    (prisma.notificationEvent.findMany as unknown as (...args: unknown[]) => unknown) = async (
      args: { where?: { category?: NotificationCategory } }
    ) => pendingByCategory[args.where?.category ?? NotificationCategory.NEW_PROPOSAL] ?? [];
    (prisma.notificationEvent.updateMany as unknown as (...args: unknown[]) => unknown) = async (
      args: unknown
    ) => {
      eventUpdateManyArgs.push(args);
      return { count: 2 };
    };
    (prisma.notificationPreference.update as unknown as (...args: unknown[]) => unknown) = async (
      args: unknown
    ) => {
      preferenceUpdateArgs.push(args);
      return {};
    };
    (prisma.$transaction as unknown as (...args: unknown[]) => unknown) = async (
      operations: unknown[]
    ) => {
      transactionOperationCounts.push(operations.length);
      return [];
    };

    await flushDueNotificationDigests({
      userAliases: [userAlias],
      now
    });

    assert.equal(transactionOperationCounts.length, 1);
    assert.deepEqual(transactionOperationCounts, [3]);
    assert.equal(eventUpdateManyArgs.length, 1);
    assert.equal(preferenceUpdateArgs.length, 2);
  } finally {
    (prisma.notificationPreference.findMany as unknown as typeof prisma.notificationPreference.findMany) =
      originalPreferenceFindMany;
    (prisma.notificationEvent.findMany as unknown as typeof prisma.notificationEvent.findMany) =
      originalEventFindMany;
    (prisma.notificationEvent.updateMany as unknown as typeof prisma.notificationEvent.updateMany) =
      originalEventUpdateMany;
    (prisma.notificationPreference.update as unknown as typeof prisma.notificationPreference.update) =
      originalPreferenceUpdate;
    (prisma.$transaction as unknown as typeof prisma.$transaction) = originalTransaction;
  }
});
