ALTER TABLE "User"
  ADD COLUMN "loginName" TEXT;

CREATE UNIQUE INDEX "User_loginName_key"
  ON "User"("loginName");
