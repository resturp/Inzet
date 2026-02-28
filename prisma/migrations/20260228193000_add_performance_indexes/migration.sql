-- CreateIndex
CREATE INDEX "User_isActive_alias_idx" ON "User"("isActive", "alias");

-- CreateIndex
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");

-- CreateIndex
CREATE INDEX "Task_status_date_idx" ON "Task"("status", "date");

-- CreateIndex
CREATE INDEX "OpenTask_status_createdAt_idx" ON "OpenTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OpenTask_proposerAlias_status_createdAt_idx" ON "OpenTask"("proposerAlias", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AliasChangeProposal_requestedAlias_status_idx" ON "AliasChangeProposal"("requestedAlias", "status");

-- CreateIndex
CREATE INDEX "MagicLinkToken_tokenHash_usedAt_expiresAt_createdAt_idx" ON "MagicLinkToken"("tokenHash", "usedAt", "expiresAt", "createdAt");
