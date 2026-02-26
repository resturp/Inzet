CREATE TABLE "AliasChangeProposal" (
    "id" TEXT NOT NULL,
    "requesterAlias" TEXT NOT NULL,
    "currentAlias" TEXT NOT NULL,
    "requestedAlias" TEXT NOT NULL,
    "status" "OpenTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AliasChangeProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AliasChangeProposal_requesterAlias_status_key"
  ON "AliasChangeProposal"("requesterAlias", "status");

CREATE INDEX "AliasChangeProposal_status_createdAt_idx"
  ON "AliasChangeProposal"("status", "createdAt");

ALTER TABLE "AliasChangeProposal"
  ADD CONSTRAINT "AliasChangeProposal_requesterAlias_fkey"
  FOREIGN KEY ("requesterAlias") REFERENCES "User"("alias")
  ON DELETE CASCADE ON UPDATE CASCADE;
