import { NotificationCategory, NotificationDelivery } from "@prisma/client";
import { resolveEffectiveCoordinatorAliases } from "@/lib/authorization";
import { sendMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { canActorDecideProposal } from "@/lib/rules";

type NotificationSettingsMap = Record<NotificationCategory, NotificationDelivery>;

type UserNotificationMessage = {
  userAlias: string;
  subject: string;
  body: string;
};

type CreatedTaskNotificationInput = {
  id: string;
  title: string;
  parentId: string | null;
};

const DIGEST_DELIVERIES: NotificationDelivery[] = [
  NotificationDelivery.HOURLY,
  NotificationDelivery.DAILY,
  NotificationDelivery.WEEKLY,
  NotificationDelivery.MONTHLY
];
const DEFAULT_APP_BASE_URL = "http://localhost:3000";
const NOTIFICATION_SETTINGS_HINT =
  "Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.";
const NOTIFICATION_MAIL_CLOSING =
  "Hartelijk dank voor je actieve bijdrage aan de sportiviteit en het plezier binnen onze vereniging.";

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  NotificationCategory.NEW_PROPOSAL,
  NotificationCategory.PROPOSAL_ACCEPTED,
  NotificationCategory.TASK_CHANGED_AS_COORDINATOR,
  NotificationCategory.TASK_BECAME_AVAILABLE_AS_COORDINATOR,
  NotificationCategory.SUBTASK_CREATED_IN_SUBSCRIPTION
];

export const NOTIFICATION_DEFAULT_DELIVERY: NotificationSettingsMap = {
  [NotificationCategory.NEW_PROPOSAL]: NotificationDelivery.IMMEDIATE,
  [NotificationCategory.PROPOSAL_ACCEPTED]: NotificationDelivery.IMMEDIATE,
  [NotificationCategory.TASK_CHANGED_AS_COORDINATOR]: NotificationDelivery.DAILY,
  [NotificationCategory.TASK_BECAME_AVAILABLE_AS_COORDINATOR]: NotificationDelivery.IMMEDIATE,
  [NotificationCategory.SUBTASK_CREATED_IN_SUBSCRIPTION]: NotificationDelivery.HOURLY
};

function uniqueValues<T extends string>(values: Iterable<T>): T[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))) as T[];
}

function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) {
    return DEFAULT_APP_BASE_URL;
  }
  return configured.replace(/\/+$/, "");
}

function buildAppUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${appBaseUrl()}${normalizedPath}`;
}

function accountDeepLinkUrl(): string {
  return buildAppUrl("/tasks?dialog=account&accountTab=NOTIFICATIES");
}

function taskDeepLinkUrl(taskId: string): string {
  return buildAppUrl(`/tasks?task=${encodeURIComponent(taskId)}&view=BESCHIKBAAR`);
}

function proposalDeepLinkUrl(proposalId: string): string {
  return buildAppUrl(`/tasks?view=OPEN_VOORSTELLEN&proposal=${encodeURIComponent(proposalId)}`);
}

function withLinks(
  lines: readonly string[],
  links: ReadonlyArray<{ label: string; url: string | null }>
): string {
  const linkLines = links
    .filter((link): link is { label: string; url: string } => Boolean(link.url))
    .map((link) => `${link.label}: ${link.url}`);

  if (linkLines.length === 0) {
    return [...lines, "", NOTIFICATION_SETTINGS_HINT, `Accountpagina: ${accountDeepLinkUrl()}`].join(
      "\n"
    );
  }

  return [
    ...lines,
    "",
    ...linkLines,
    "",
    NOTIFICATION_SETTINGS_HINT,
    `Accountpagina: ${accountDeepLinkUrl()}`
  ].join("\n");
}

function withNotificationMailEnvelope(userAlias: string, body: string): string {
  return [
    `Beste ${userAlias},`,
    "",
    "Dit bericht ontvang je omdat er een relevante update voor jou is in Inzet.",
    "",
    body,
    "",
    NOTIFICATION_MAIL_CLOSING,
    "",
    "--",
    "Inzet notificatie"
  ].join("\n");
}

function digestIntervalMs(delivery: NotificationDelivery): number {
  switch (delivery) {
    case NotificationDelivery.HOURLY:
      return 60 * 60 * 1000;
    case NotificationDelivery.DAILY:
      return 24 * 60 * 60 * 1000;
    case NotificationDelivery.WEEKLY:
      return 7 * 24 * 60 * 60 * 1000;
    case NotificationDelivery.MONTHLY:
      return 30 * 24 * 60 * 60 * 1000;
    case NotificationDelivery.OFF:
    case NotificationDelivery.IMMEDIATE:
      return 0;
  }
}

function labelForCategory(category: NotificationCategory): string {
  switch (category) {
    case NotificationCategory.NEW_PROPOSAL:
      return "Nieuwe voorstellen";
    case NotificationCategory.PROPOSAL_ACCEPTED:
      return "Reactie op jouw voorstel";
    case NotificationCategory.TASK_CHANGED_AS_COORDINATOR:
      return "Wijzigingen op je coordinatietaken";
    case NotificationCategory.TASK_BECAME_AVAILABLE_AS_COORDINATOR:
      return "Beschikbaar gestelde taken";
    case NotificationCategory.SUBTASK_CREATED_IN_SUBSCRIPTION:
      return "Nieuwe subtaken op abonnement";
  }
}

function labelForDelivery(delivery: NotificationDelivery): string {
  switch (delivery) {
    case NotificationDelivery.HOURLY:
      return "elk uur";
    case NotificationDelivery.DAILY:
      return "dagelijks";
    case NotificationDelivery.WEEKLY:
      return "wekelijks";
    case NotificationDelivery.MONTHLY:
      return "maandelijks";
    case NotificationDelivery.IMMEDIATE:
      return "direct";
    case NotificationDelivery.OFF:
      return "uit";
  }
}

function mergeMessagesPerUser(messages: readonly UserNotificationMessage[]): UserNotificationMessage[] {
  const grouped = new Map<string, UserNotificationMessage[]>();

  for (const message of messages) {
    const current = grouped.get(message.userAlias);
    if (current) {
      current.push(message);
      continue;
    }
    grouped.set(message.userAlias, [message]);
  }

  return Array.from(grouped.entries()).map(([userAlias, userMessages]) => {
    if (userMessages.length === 1) {
      return userMessages[0];
    }

    const [first, ...rest] = userMessages;
    const bodyParts = [first.body, ...rest.map((item) => item.body)];
    return {
      userAlias,
      subject: `${first.subject} (+${rest.length})`,
      body: bodyParts.join("\n\n---\n\n")
    };
  });
}

async function dispatchCategoryMessages(
  category: NotificationCategory,
  messages: readonly UserNotificationMessage[],
  excludeAliases: readonly string[] = []
): Promise<void> {
  const excluded = new Set(uniqueValues(excludeAliases));
  const uniqueMessages = mergeMessagesPerUser(
    messages.filter((message) => !excluded.has(message.userAlias))
  );
  if (uniqueMessages.length === 0) {
    return;
  }

  const recipientAliases = uniqueValues(uniqueMessages.map((message) => message.userAlias));
  await ensureNotificationPreferencesForUsers(recipientAliases);

  const [users, preferences] = await Promise.all([
    prisma.user.findMany({
      where: {
        alias: { in: recipientAliases },
        isActive: true,
        email: { not: null }
      },
      select: {
        alias: true,
        email: true
      }
    }),
    prisma.notificationPreference.findMany({
      where: {
        userAlias: { in: recipientAliases },
        category
      },
      select: {
        userAlias: true,
        delivery: true
      }
    })
  ]);

  const userByAlias = new Map(users.map((user) => [user.alias, user]));
  const deliveryByAlias = new Map(
    preferences.map((preference) => [preference.userAlias, preference.delivery])
  );

  const digestRows: Array<{
    userAlias: string;
    category: NotificationCategory;
    subject: string;
    body: string;
  }> = [];

  for (const message of uniqueMessages) {
    const user = userByAlias.get(message.userAlias);
    if (!user?.email) {
      continue;
    }

    const delivery =
      deliveryByAlias.get(message.userAlias) ?? NOTIFICATION_DEFAULT_DELIVERY[category];
    if (delivery === NotificationDelivery.OFF) {
      continue;
    }

    if (delivery === NotificationDelivery.IMMEDIATE) {
      try {
        await sendMail({
          to: user.email,
          subject: message.subject,
          text: withNotificationMailEnvelope(message.userAlias, message.body)
        });
      } catch (error) {
        console.error("Failed to send immediate notification", {
          category,
          userAlias: message.userAlias,
          error
        });
      }
      continue;
    }

    digestRows.push({
      userAlias: message.userAlias,
      category,
      subject: message.subject,
      body: message.body
    });
  }

  if (digestRows.length > 0) {
    await prisma.notificationEvent.createMany({
      data: digestRows
    });
    await flushDueNotificationDigests({
      userAliases: uniqueValues(digestRows.map((row) => row.userAlias)),
      categories: [category]
    });
  }
}

export async function ensureNotificationPreferencesForUsers(
  userAliases: readonly string[]
): Promise<void> {
  const aliases = uniqueValues(userAliases);
  if (aliases.length === 0) {
    return;
  }

  await prisma.notificationPreference.createMany({
    data: aliases.flatMap((userAlias) =>
      NOTIFICATION_CATEGORIES.map((category) => ({
        userAlias,
        category,
        delivery: NOTIFICATION_DEFAULT_DELIVERY[category]
      }))
    ),
    skipDuplicates: true
  });
}

export async function getNotificationSettingsForUser(
  userAlias: string
): Promise<NotificationSettingsMap> {
  await ensureNotificationPreferencesForUsers([userAlias]);

  const rows = await prisma.notificationPreference.findMany({
    where: { userAlias },
    select: {
      category: true,
      delivery: true
    }
  });

  const settings = {
    ...NOTIFICATION_DEFAULT_DELIVERY
  };

  for (const row of rows) {
    settings[row.category] = row.delivery;
  }

  return settings;
}

export async function updateNotificationSettingsForUser(
  userAlias: string,
  updates: Partial<NotificationSettingsMap>
): Promise<void> {
  const entries = Object.entries(updates).filter(
    (entry): entry is [NotificationCategory, NotificationDelivery] => entry[1] !== undefined
  );
  if (entries.length === 0) {
    return;
  }

  await ensureNotificationPreferencesForUsers([userAlias]);

  await Promise.all(
    entries.map(([category, delivery]) =>
      prisma.notificationPreference.upsert({
        where: {
          userAlias_category: {
            userAlias,
            category
          }
        },
        update: {
          delivery
        },
        create: {
          userAlias,
          category,
          delivery
        }
      })
    )
  );
}

export async function flushDueNotificationDigests(params?: {
  userAliases?: readonly string[];
  categories?: readonly NotificationCategory[];
  now?: Date;
}): Promise<void> {
  const now = params?.now ?? new Date();

  const whereUserAliases = params?.userAliases ? uniqueValues(params.userAliases) : null;
  const whereCategories = params?.categories ? uniqueValues(params.categories) : null;

  const preferences = await prisma.notificationPreference.findMany({
    where: {
      delivery: { in: DIGEST_DELIVERIES },
      ...(whereUserAliases && whereUserAliases.length > 0
        ? { userAlias: { in: whereUserAliases } }
        : {}),
      ...(whereCategories && whereCategories.length > 0
        ? { category: { in: whereCategories } }
        : {})
    },
    include: {
      user: {
        select: {
          alias: true,
          email: true,
          isActive: true
        }
      }
    }
  });

  for (const preference of preferences) {
    if (!preference.user.isActive || !preference.user.email) {
      continue;
    }

    const pending = await prisma.notificationEvent.findMany({
      where: {
        userAlias: preference.userAlias,
        category: preference.category,
        deliveredAt: null
      },
      orderBy: {
        createdAt: "asc"
      },
      take: 200
    });

    if (pending.length === 0) {
      continue;
    }

    const intervalMs = digestIntervalMs(preference.delivery);
    const referenceDate = preference.lastDigestSentAt ?? pending[0].createdAt;
    if (now.getTime() - referenceDate.getTime() < intervalMs) {
      continue;
    }

    const digestSubject = `Inzet digest (${labelForDelivery(preference.delivery)}): ${labelForCategory(
      preference.category
    )}`;
    const digestLines = pending.map(
      (item, index) =>
        `${index + 1}. ${new Date(item.createdAt).toLocaleString("nl-NL")}\n${item.subject}\n${item.body}`
    );

    try {
      await sendMail({
        to: preference.user.email,
        subject: digestSubject,
        text: [
          `Beste ${preference.userAlias},`,
          "",
          "Dit bericht ontvang je omdat er een relevante update voor jou is in Inzet.",
          "",
          `Je hebt ${pending.length} nieuwe notificatie(s) in categorie \"${labelForCategory(
            preference.category
          )}\".`,
          "",
          ...digestLines,
          "",
          NOTIFICATION_MAIL_CLOSING,
          "",
          "--",
          "Inzet notificatie digest"
        ].join("\n")
      });

      await prisma.$transaction([
        prisma.notificationEvent.updateMany({
          where: {
            id: { in: pending.map((item) => item.id) },
            deliveredAt: null
          },
          data: {
            deliveredAt: now
          }
        }),
        prisma.notificationPreference.update({
          where: {
            userAlias_category: {
              userAlias: preference.userAlias,
              category: preference.category
            }
          },
          data: {
            lastDigestSentAt: now
          }
        })
      ]);
    } catch (error) {
      console.error("Failed to send digest notification", {
        userAlias: preference.userAlias,
        category: preference.category,
        error
      });
    }
  }
}

export async function notifyTaskProposalDecisionRequired(params: {
  taskId: string;
  taskTitle: string;
  proposerAlias: string;
  proposedAlias: string;
  openTaskId?: string;
  effectiveCoordinatorAliases?: readonly string[];
  actorAlias?: string;
}): Promise<void> {
  const effectiveCoordinatorAliases = params.effectiveCoordinatorAliases
    ? uniqueValues(params.effectiveCoordinatorAliases)
    : await resolveEffectiveCoordinatorAliases(params.taskId);
  const candidates = uniqueValues([
    params.proposerAlias,
    params.proposedAlias,
    ...effectiveCoordinatorAliases
  ]);

  const decisionAliases = candidates.filter((candidateAlias) =>
    canActorDecideProposal({
      proposerAlias: params.proposerAlias,
      proposedAlias: params.proposedAlias,
      actorAlias: candidateAlias,
      effectiveCoordinatorAliases
    })
  );

  if (decisionAliases.length === 0) {
    return;
  }

  await dispatchCategoryMessages(
    NotificationCategory.NEW_PROPOSAL,
    decisionAliases.map((userAlias) => ({
      userAlias,
      subject: `Nieuw voorstel: ${params.taskTitle}`,
      body: withLinks(
        [
          `Er staat een voorstel klaar voor taak \"${params.taskTitle}\".`,
          `Voorgesteld door: ${params.proposerAlias}`,
          `Voorgesteld aan: ${params.proposedAlias}`
        ],
        [
          {
            label: "Naar voorstel",
            url: params.openTaskId ? proposalDeepLinkUrl(params.openTaskId) : null
          },
          { label: "Naar taak", url: taskDeepLinkUrl(params.taskId) }
        ]
      )
    })),
    params.actorAlias ? [params.actorAlias] : []
  );
}

export async function notifyAliasChangeDecisionRequired(params: {
  requesterAlias: string;
  requestedAlias: string;
  proposalId?: string;
  decisionAliases: readonly string[];
  actorAlias?: string;
}): Promise<void> {
  const decisionAliases = uniqueValues(params.decisionAliases);
  if (decisionAliases.length === 0) {
    return;
  }

  await dispatchCategoryMessages(
    NotificationCategory.NEW_PROPOSAL,
    decisionAliases.map((userAlias) => ({
      userAlias,
      subject: `Nieuw voorstel: aliaswijziging ${params.requesterAlias}`,
      body: withLinks(
        [
          `${params.requesterAlias} vraagt aliaswijziging aan.`,
          `Nieuwe alias: ${params.requestedAlias}`
        ],
        [
          {
            label: "Naar voorstel",
            url: params.proposalId ? proposalDeepLinkUrl(params.proposalId) : null
          }
        ]
      )
    })),
    params.actorAlias ? [params.actorAlias] : []
  );
}

export async function notifyProposalAccepted(params: {
  recipientAlias: string;
  actorAlias: string;
  taskTitle: string;
  taskId?: string;
  proposalId?: string;
}): Promise<void> {
  await notifyProposalResponded({
    recipientAlias: params.recipientAlias,
    actorAlias: params.actorAlias,
    taskTitle: params.taskTitle,
    taskId: params.taskId,
    proposalId: params.proposalId,
    response: "ACCEPTED"
  });
}

export async function notifyProposalResponded(params: {
  recipientAlias: string;
  actorAlias: string;
  taskTitle: string;
  taskId?: string;
  proposalId?: string;
  response: "ACCEPTED" | "REJECTED";
}): Promise<void> {
  const accepted = params.response === "ACCEPTED";
  await dispatchCategoryMessages(
    NotificationCategory.PROPOSAL_ACCEPTED,
    [
      {
        userAlias: params.recipientAlias,
        subject: accepted
          ? `Voorstel geaccepteerd: ${params.taskTitle}`
          : `Voorstel afgewezen: ${params.taskTitle}`,
        body: withLinks(
          [
            accepted
              ? `${params.actorAlias} heeft een voorstel voor taak \"${params.taskTitle}\" geaccepteerd.`
              : `${params.actorAlias} heeft een voorstel voor taak \"${params.taskTitle}\" afgewezen.`
          ],
          [
            {
              label: "Naar voorstel",
              url: params.proposalId ? proposalDeepLinkUrl(params.proposalId) : null
            },
            {
              label: "Naar taak",
              url: params.taskId ? taskDeepLinkUrl(params.taskId) : null
            }
          ]
        )
      }
    ],
    [params.actorAlias]
  );
}

export async function notifyTaskChangedForEffectiveCoordinators(params: {
  taskId: string;
  taskTitle: string;
  actorAlias: string;
  summary?: string;
}): Promise<void> {
  const coordinatorAliases = await resolveEffectiveCoordinatorAliases(params.taskId);
  if (coordinatorAliases.length === 0) {
    return;
  }

  await dispatchCategoryMessages(
    NotificationCategory.TASK_CHANGED_AS_COORDINATOR,
    coordinatorAliases.map((userAlias) => ({
      userAlias,
      subject: `Taak gewijzigd: ${params.taskTitle}`,
      body: withLinks(
        params.summary
          ? [`${params.actorAlias} heeft taak \"${params.taskTitle}\" gewijzigd.`, params.summary]
          : [`${params.actorAlias} heeft taak \"${params.taskTitle}\" gewijzigd.`],
        [{ label: "Naar taak", url: taskDeepLinkUrl(params.taskId) }]
      )
    })),
    [params.actorAlias]
  );
}

export async function notifyTaskBecameAvailableForEffectiveCoordinators(params: {
  taskId: string;
  taskTitle: string;
  actorAlias: string;
}): Promise<void> {
  const coordinatorAliases = await resolveEffectiveCoordinatorAliases(params.taskId);
  if (coordinatorAliases.length === 0) {
    return;
  }

  await dispatchCategoryMessages(
    NotificationCategory.TASK_BECAME_AVAILABLE_AS_COORDINATOR,
    coordinatorAliases.map((userAlias) => ({
      userAlias,
      subject: `Taak beschikbaar: ${params.taskTitle}`,
      body: withLinks(
        [`${params.actorAlias} heeft taak \"${params.taskTitle}\" beschikbaar gesteld.`],
        [{ label: "Naar taak", url: taskDeepLinkUrl(params.taskId) }]
      )
    })),
    [params.actorAlias]
  );
}

async function resolveAncestorChain(
  startParentId: string
): Promise<Array<{ id: string; title: string }>> {
  const chain: Array<{ id: string; title: string }> = [];
  const visited = new Set<string>();
  let currentId: string | null = startParentId;

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const ancestorRow: { id: string; title: string; parentId: string | null } | null =
      await prisma.task.findUnique({
        where: { id: currentId },
        select: {
          id: true,
          title: true,
          parentId: true
        }
      });

    if (!ancestorRow) {
      break;
    }

    chain.push({ id: ancestorRow.id, title: ancestorRow.title });
    currentId = ancestorRow.parentId;
  }

  return chain;
}

export async function notifySubtasksCreatedForSubscriptions(params: {
  actorAlias: string;
  createdTasks: readonly CreatedTaskNotificationInput[];
}): Promise<void> {
  const tasksWithParent = params.createdTasks.filter(
    (task): task is CreatedTaskNotificationInput & { parentId: string } => Boolean(task.parentId)
  );
  if (tasksWithParent.length === 0) {
    return;
  }

  const linesByUserAlias = new Map<string, string[]>();

  for (const createdTask of tasksWithParent) {
    const ancestorChain = await resolveAncestorChain(createdTask.parentId);
    if (ancestorChain.length === 0) {
      continue;
    }

    const subscriptions = await prisma.taskSubscription.findMany({
      where: {
        taskId: { in: ancestorChain.map((item) => item.id) },
        userAlias: { not: params.actorAlias }
      },
      include: {
        task: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });

    if (subscriptions.length === 0) {
      continue;
    }

    const subscriptionsByTaskId = new Map<string, typeof subscriptions>();
    for (const subscription of subscriptions) {
      const current = subscriptionsByTaskId.get(subscription.taskId);
      if (current) {
        current.push(subscription);
        continue;
      }
      subscriptionsByTaskId.set(subscription.taskId, [subscription]);
    }

    const nearestSubscriptionByUser = new Map<string, { subscriptionTitle: string; parentTitle: string }>();

    for (const ancestor of ancestorChain) {
      const onAncestor = subscriptionsByTaskId.get(ancestor.id) ?? [];
      for (const subscription of onAncestor) {
        if (nearestSubscriptionByUser.has(subscription.userAlias)) {
          continue;
        }
        nearestSubscriptionByUser.set(subscription.userAlias, {
          subscriptionTitle: subscription.task.title,
          parentTitle: ancestorChain[0]?.title ?? createdTask.title
        });
      }
    }

    for (const [userAlias, nearest] of nearestSubscriptionByUser.entries()) {
      const current = linesByUserAlias.get(userAlias) ?? [];
      current.push(
        `Nieuwe subtaak \"${createdTask.title}\" onder \"${nearest.parentTitle}\" (abonnement: \"${nearest.subscriptionTitle}\"). Taak: ${taskDeepLinkUrl(createdTask.id)}`
      );
      linesByUserAlias.set(userAlias, current);
    }
  }

  if (linesByUserAlias.size === 0) {
    return;
  }

  const messages: UserNotificationMessage[] = Array.from(linesByUserAlias.entries()).map(
    ([userAlias, lines]) => ({
      userAlias,
      subject: `Nieuwe subtaken in je abonnementen (${lines.length})`,
      body: withLinks(lines.map((line, index) => `${index + 1}. ${line}`), [])
    })
  );

  await dispatchCategoryMessages(
    NotificationCategory.SUBTASK_CREATED_IN_SUBSCRIPTION,
    messages,
    [params.actorAlias]
  );
}
