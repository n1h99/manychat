-- AlterEnum
ALTER TYPE "CrmOperationType" ADD VALUE 'FORWARD_OUTBOUND_MESSAGE';

-- AlterTable
ALTER TABLE "crm_operations" ADD COLUMN "messageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "crm_operations_messageId_key" ON "crm_operations"("messageId");

-- CreateIndex
CREATE INDEX "crm_operations_projectId_messageId_idx" ON "crm_operations"("projectId", "messageId");

-- AddForeignKey
ALTER TABLE "crm_operations" ADD CONSTRAINT "crm_operations_projectId_messageId_fkey"
FOREIGN KEY ("projectId", "messageId") REFERENCES "messages"("projectId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
