-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('TELEGRAM', 'CRM');

-- CreateEnum
CREATE TYPE "CrmOperationType" AS ENUM ('CREATE_OR_UPDATE_LEAD', 'FORWARD_INBOUND_MESSAGE');

-- AlterTable
ALTER TABLE "outbox_records" ADD COLUMN     "kind" "OutboxKind" NOT NULL DEFAULT 'TELEGRAM',
ALTER COLUMN "connectionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "crm_project_configs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "crmProjectId" TEXT NOT NULL,
    "fieldMapping" JSONB NOT NULL DEFAULT '{}',
    "defaultPipeline" TEXT,
    "defaultStage" TEXT,
    "additionalParameters" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_project_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_operations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "outboxRecordId" TEXT NOT NULL,
    "contactId" TEXT,
    "normalizedEventId" TEXT,
    "type" "CrmOperationType" NOT NULL,
    "inputSafe" JSONB NOT NULL,
    "resultSafe" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_project_configs_projectId_key" ON "crm_project_configs"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_project_configs_projectId_id_key" ON "crm_project_configs"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_project_configs_projectId_crmProjectId_key" ON "crm_project_configs"("projectId", "crmProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_operations_outboxRecordId_key" ON "crm_operations"("outboxRecordId");

-- CreateIndex
CREATE INDEX "crm_operations_projectId_contactId_idx" ON "crm_operations"("projectId", "contactId");

-- CreateIndex
CREATE INDEX "crm_operations_projectId_normalizedEventId_idx" ON "crm_operations"("projectId", "normalizedEventId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_operations_projectId_id_key" ON "crm_operations"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_operations_projectId_outboxRecordId_key" ON "crm_operations"("projectId", "outboxRecordId");

-- AddForeignKey
ALTER TABLE "crm_project_configs" ADD CONSTRAINT "crm_project_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_operations" ADD CONSTRAINT "crm_operations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_operations" ADD CONSTRAINT "crm_operations_projectId_outboxRecordId_fkey" FOREIGN KEY ("projectId", "outboxRecordId") REFERENCES "outbox_records"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_operations" ADD CONSTRAINT "crm_operations_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_operations" ADD CONSTRAINT "crm_operations_projectId_normalizedEventId_fkey" FOREIGN KEY ("projectId", "normalizedEventId") REFERENCES "normalized_events"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
