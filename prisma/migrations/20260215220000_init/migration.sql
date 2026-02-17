-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('LID', 'COORDINATOR', 'BESTUUR');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BESCHIKBAAR', 'TOEGEWEZEN', 'GEREED');

-- CreateEnum
CREATE TYPE "OpenTaskStatus" AS ENUM ('OPEN', 'AFGEWEZEN');

-- CreateTable
CREATE TABLE "User" (
    "alias" TEXT NOT NULL,
    "bondsnummer" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'LID',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultPoints" DECIMAL(20,8),
    "parentTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "teamName" TEXT,
    "parentId" TEXT,
    "points" DECIMAL(20,8) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "templateId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'BESCHIKBAAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCoordinator" (
    "taskId" TEXT NOT NULL,
    "userAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCoordinator_pkey" PRIMARY KEY ("taskId","userAlias")
);

-- CreateTable
CREATE TABLE "OpenTask" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "proposerAlias" TEXT NOT NULL,
    "proposedAlias" TEXT,
    "status" "OpenTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorAlias" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "userAlias" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_bondsnummer_key" ON "User"("bondsnummer");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "TaskCoordinator_userAlias_idx" ON "TaskCoordinator"("userAlias");

-- CreateIndex
CREATE UNIQUE INDEX "OpenTask_taskId_proposerAlias_proposedAlias_status_key" ON "OpenTask"("taskId", "proposerAlias", "proposedAlias", "status");

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_parentTemplateId_fkey" FOREIGN KEY ("parentTemplateId") REFERENCES "TaskTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCoordinator" ADD CONSTRAINT "TaskCoordinator_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCoordinator" ADD CONSTRAINT "TaskCoordinator_userAlias_fkey" FOREIGN KEY ("userAlias") REFERENCES "User"("alias") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTask" ADD CONSTRAINT "OpenTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTask" ADD CONSTRAINT "OpenTask_proposerAlias_fkey" FOREIGN KEY ("proposerAlias") REFERENCES "User"("alias") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTask" ADD CONSTRAINT "OpenTask_proposedAlias_fkey" FOREIGN KEY ("proposedAlias") REFERENCES "User"("alias") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MagicLinkToken" ADD CONSTRAINT "MagicLinkToken_userAlias_fkey" FOREIGN KEY ("userAlias") REFERENCES "User"("alias") ON DELETE CASCADE ON UPDATE CASCADE;

