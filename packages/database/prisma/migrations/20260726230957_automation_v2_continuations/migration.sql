-- CreateEnum
CREATE TYPE "WaitStateStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DelayedActionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ScenarioExecutionStatus" ADD VALUE 'WAITING';

-- AlterTable
ALTER TABLE "scenario_executions" ADD COLUMN     "parentExecutionId" TEXT,
ADD COLUMN     "resumeNodeId" TEXT;

-- CreateTable
CREATE TABLE "wait_states" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioExecutionId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" "WaitStateStatus" NOT NULL DEFAULT 'ACTIVE',
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "successNodeId" TEXT,
    "timeoutNodeId" TEXT,
    "resolvedByEventId" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wait_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delayed_actions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioExecutionId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "resumeNodeId" TEXT,
    "status" "DelayedActionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delayed_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wait_states_projectId_conversationId_scenarioId_status_idx" ON "wait_states"("projectId", "conversationId", "scenarioId", "status");

-- CreateIndex
CREATE INDEX "wait_states_status_expiresAt_idx" ON "wait_states"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "wait_states_projectId_id_key" ON "wait_states"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wait_states_projectId_scenarioExecutionId_nodeId_key" ON "wait_states"("projectId", "scenarioExecutionId", "nodeId");

-- CreateIndex
CREATE INDEX "delayed_actions_status_nextAttemptAt_idx" ON "delayed_actions"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "delayed_actions_projectId_scenarioExecutionId_status_idx" ON "delayed_actions"("projectId", "scenarioExecutionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delayed_actions_projectId_id_key" ON "delayed_actions"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "delayed_actions_projectId_scenarioExecutionId_nodeId_key" ON "delayed_actions"("projectId", "scenarioExecutionId", "nodeId");

-- CreateIndex
CREATE INDEX "scenario_executions_projectId_parentExecutionId_status_idx" ON "scenario_executions"("projectId", "parentExecutionId", "status");

-- AddForeignKey
ALTER TABLE "scenario_executions" ADD CONSTRAINT "scenario_executions_projectId_parentExecutionId_fkey" FOREIGN KEY ("projectId", "parentExecutionId") REFERENCES "scenario_executions"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_states" ADD CONSTRAINT "wait_states_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_states" ADD CONSTRAINT "wait_states_projectId_scenarioExecutionId_fkey" FOREIGN KEY ("projectId", "scenarioExecutionId") REFERENCES "scenario_executions"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_states" ADD CONSTRAINT "wait_states_projectId_scenarioId_fkey" FOREIGN KEY ("projectId", "scenarioId") REFERENCES "scenarios"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_states" ADD CONSTRAINT "wait_states_projectId_scenarioId_scenarioVersionId_fkey" FOREIGN KEY ("projectId", "scenarioId", "scenarioVersionId") REFERENCES "scenario_versions"("projectId", "scenarioId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_states" ADD CONSTRAINT "wait_states_projectId_conversationId_fkey" FOREIGN KEY ("projectId", "conversationId") REFERENCES "conversations"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delayed_actions" ADD CONSTRAINT "delayed_actions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delayed_actions" ADD CONSTRAINT "delayed_actions_projectId_scenarioExecutionId_fkey" FOREIGN KEY ("projectId", "scenarioExecutionId") REFERENCES "scenario_executions"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delayed_actions" ADD CONSTRAINT "delayed_actions_projectId_scenarioId_fkey" FOREIGN KEY ("projectId", "scenarioId") REFERENCES "scenarios"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delayed_actions" ADD CONSTRAINT "delayed_actions_projectId_scenarioId_scenarioVersionId_fkey" FOREIGN KEY ("projectId", "scenarioId", "scenarioVersionId") REFERENCES "scenario_versions"("projectId", "scenarioId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
