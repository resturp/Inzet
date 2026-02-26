CREATE TYPE "TaskCoordinationType" AS ENUM ('DELEGEREN', 'ORGANISEREN');

ALTER TABLE "Task"
ADD COLUMN "coordinationType" "TaskCoordinationType" NOT NULL DEFAULT 'DELEGEREN';
