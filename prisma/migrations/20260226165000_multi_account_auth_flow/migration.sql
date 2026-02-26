-- Allow multiple accounts per relation code and per e-mail address.
DROP INDEX IF EXISTS "User_bondsnummer_key";
DROP INDEX IF EXISTS "User_email_key";

-- Tokens can be tied to either an existing alias or a registration flow.
ALTER TABLE "MagicLinkToken"
  ALTER COLUMN "userAlias" DROP NOT NULL;

ALTER TABLE "MagicLinkToken"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "bondsnummer" TEXT;

CREATE INDEX "MagicLinkToken_email_bondsnummer_idx"
  ON "MagicLinkToken"("email", "bondsnummer");
