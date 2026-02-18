-- AlterTable
ALTER TABLE "Task"
  ALTER COLUMN "points" TYPE INTEGER USING ROUND("points")::INTEGER;

-- AlterTable
ALTER TABLE "TaskTemplate"
  ALTER COLUMN "defaultPoints" TYPE INTEGER
  USING CASE
    WHEN "defaultPoints" IS NULL THEN NULL
    ELSE ROUND("defaultPoints")::INTEGER
  END;
