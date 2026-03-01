-- CreateTable
CREATE TABLE "TaskCompletionSnapshot" (
  "id" TEXT NOT NULL,
  "rootTaskId" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "completedByAlias" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restoredByAlias" TEXT,
  "restoredAt" TIMESTAMP(3),

  CONSTRAINT "TaskCompletionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskCompletionSnapshot_rootTaskId_restoredAt_completedAt_idx"
  ON "TaskCompletionSnapshot"("rootTaskId", "restoredAt", "completedAt");

-- AddForeignKey
ALTER TABLE "TaskCompletionSnapshot"
  ADD CONSTRAINT "TaskCompletionSnapshot_rootTaskId_fkey"
  FOREIGN KEY ("rootTaskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
