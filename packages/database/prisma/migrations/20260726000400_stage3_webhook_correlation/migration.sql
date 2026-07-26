-- AlterTable
ALTER TABLE "raw_webhook_events"
ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'unavailable';

ALTER TABLE "raw_webhook_events"
ALTER COLUMN "correlationId" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "raw_webhook_events_projectId_correlationId_idx"
ON "raw_webhook_events"("projectId", "correlationId");
