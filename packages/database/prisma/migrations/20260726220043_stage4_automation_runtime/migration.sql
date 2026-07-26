-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScenarioVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ScenarioExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NodeExecutionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "automationModeOverride" "AutomationMode",
ADD COLUMN     "lastMessageAt" TIMESTAMPTZ(3),
ADD COLUMN     "nextAutomationSequence" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'DRAFT',
    "activeVersionId" TEXT,
    "draftVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_versions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ScenarioVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "graph" JSONB NOT NULL,
    "variablesSchema" JSONB NOT NULL DEFAULT '{}',
    "compiledDefinition" JSONB,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "contentHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "scenario_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_executions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "triggerEventId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "conversationSequence" BIGINT NOT NULL,
    "status" "ScenarioExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "currentNodeId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "correlationId" TEXT NOT NULL,
    "cancellationRequestedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "errorSafe" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scenario_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_executions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioExecutionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "NodeExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "inputSafe" JSONB NOT NULL DEFAULT '{}',
    "outputSafe" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "attemptGroup" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorSafe" JSONB,

    CONSTRAINT "node_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenarios_projectId_status_idx" ON "scenarios"("projectId", "status");

-- CreateIndex
CREATE INDEX "scenarios_projectId_updatedAt_idx" ON "scenarios"("projectId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_projectId_id_key" ON "scenarios"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_projectId_id_activeVersionId_key" ON "scenarios"("projectId", "id", "activeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_projectId_id_draftVersionId_key" ON "scenarios"("projectId", "id", "draftVersionId");

-- CreateIndex
CREATE INDEX "scenario_versions_projectId_scenarioId_status_idx" ON "scenario_versions"("projectId", "scenarioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_versions_projectId_id_key" ON "scenario_versions"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_versions_projectId_scenarioId_id_key" ON "scenario_versions"("projectId", "scenarioId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_versions_projectId_scenarioId_version_key" ON "scenario_versions"("projectId", "scenarioId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_versions_projectId_scenarioId_contentHash_key" ON "scenario_versions"("projectId", "scenarioId", "contentHash");

-- CreateIndex
CREATE INDEX "scenario_executions_projectId_conversationId_conversationSe_idx" ON "scenario_executions"("projectId", "conversationId", "conversationSequence");

-- CreateIndex
CREATE INDEX "scenario_executions_projectId_status_updatedAt_idx" ON "scenario_executions"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "scenario_executions_projectId_triggerEventId_idx" ON "scenario_executions"("projectId", "triggerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_executions_projectId_id_key" ON "scenario_executions"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_executions_projectId_scenarioId_triggerKey_key" ON "scenario_executions"("projectId", "scenarioId", "triggerKey");

-- CreateIndex
CREATE INDEX "node_executions_projectId_scenarioExecutionId_status_idx" ON "node_executions"("projectId", "scenarioExecutionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "node_executions_projectId_id_key" ON "node_executions"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "node_executions_projectId_scenarioExecutionId_nodeId_attemp_key" ON "node_executions"("projectId", "scenarioExecutionId", "nodeId", "attemptGroup");

-- CreateIndex
CREATE UNIQUE INDEX "node_executions_projectId_idempotencyKey_key" ON "node_executions"("projectId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_projectId_id_activeVersionId_fkey" FOREIGN KEY ("projectId", "id", "activeVersionId") REFERENCES "scenario_versions"("projectId", "scenarioId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_projectId_id_draftVersionId_fkey" FOREIGN KEY ("projectId", "id", "draftVersionId") REFERENCES "scenario_versions"("projectId", "scenarioId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_projectId_scenarioId_fkey" FOREIGN KEY ("projectId", "scenarioId") REFERENCES "scenarios"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_executions" ADD CONSTRAINT "scenario_executions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_executions" ADD CONSTRAINT "scenario_executions_projectId_scenarioId_fkey" FOREIGN KEY ("projectId", "scenarioId") REFERENCES "scenarios"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_executions" ADD CONSTRAINT "scenario_executions_projectId_scenarioId_scenarioVersionId_fkey" FOREIGN KEY ("projectId", "scenarioId", "scenarioVersionId") REFERENCES "scenario_versions"("projectId", "scenarioId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_executions" ADD CONSTRAINT "scenario_executions_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_executions" ADD CONSTRAINT "scenario_executions_projectId_conversationId_fkey" FOREIGN KEY ("projectId", "conversationId") REFERENCES "conversations"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_executions" ADD CONSTRAINT "scenario_executions_projectId_triggerEventId_fkey" FOREIGN KEY ("projectId", "triggerEventId") REFERENCES "normalized_events"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_projectId_scenarioExecutionId_fkey" FOREIGN KEY ("projectId", "scenarioExecutionId") REFERENCES "scenario_executions"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
