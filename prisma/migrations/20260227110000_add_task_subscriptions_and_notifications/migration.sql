-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM (
  'NEW_PROPOSAL',
  'PROPOSAL_ACCEPTED',
  'TASK_CHANGED_AS_COORDINATOR',
  'TASK_BECAME_AVAILABLE_AS_COORDINATOR',
  'SUBTASK_CREATED_IN_SUBSCRIPTION'
);

-- CreateEnum
CREATE TYPE "NotificationDelivery" AS ENUM (
  'OFF',
  'IMMEDIATE',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY'
);

-- CreateTable
CREATE TABLE "TaskSubscription" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userAlias" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaskSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
  "userAlias" TEXT NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "delivery" "NotificationDelivery" NOT NULL DEFAULT 'OFF',
  "lastDigestSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userAlias", "category")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
  "id" TEXT NOT NULL,
  "userAlias" TEXT NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),

  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskSubscription_taskId_userAlias_key" ON "TaskSubscription"("taskId", "userAlias");

-- CreateIndex
CREATE INDEX "TaskSubscription_userAlias_idx" ON "TaskSubscription"("userAlias");

-- CreateIndex
CREATE INDEX "NotificationPreference_category_delivery_idx" ON "NotificationPreference"("category", "delivery");

-- CreateIndex
CREATE INDEX "NotificationEvent_userAlias_category_deliveredAt_createdAt_idx" ON "NotificationEvent"("userAlias", "category", "deliveredAt", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskSubscription" ADD CONSTRAINT "TaskSubscription_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSubscription" ADD CONSTRAINT "TaskSubscription_userAlias_fkey" FOREIGN KEY ("userAlias") REFERENCES "User"("alias") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userAlias_fkey" FOREIGN KEY ("userAlias") REFERENCES "User"("alias") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_userAlias_fkey" FOREIGN KEY ("userAlias") REFERENCES "User"("alias") ON DELETE CASCADE ON UPDATE CASCADE;
