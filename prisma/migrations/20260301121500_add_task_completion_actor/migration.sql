-- AlterTable
ALTER TABLE "Task"
  ADD COLUMN "completedByAlias" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_completedByAlias_completedAt_idx"
  ON "Task"("completedByAlias", "completedAt");

-- AddForeignKey
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_completedByAlias_fkey"
  FOREIGN KEY ("completedByAlias") REFERENCES "User"("alias")
  ON DELETE SET NULL ON UPDATE CASCADE;
