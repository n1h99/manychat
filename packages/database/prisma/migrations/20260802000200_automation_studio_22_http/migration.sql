ALTER TYPE "OutboxKind" ADD VALUE 'HTTP';

CREATE TABLE "automation_secrets" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "valueEncrypted" JSONB NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "automation_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_http_operations" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "outboxRecordId" TEXT NOT NULL,
  "scenarioExecutionId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "successNodeId" TEXT,
  "failureNodeId" TEXT,
  "resultSafe" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "external_http_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_secrets_projectId_id_key"
  ON "automation_secrets"("projectId", "id");
CREATE UNIQUE INDEX "automation_secrets_projectId_normalizedName_key"
  ON "automation_secrets"("projectId", "normalizedName");
CREATE INDEX "automation_secrets_projectId_archivedAt_name_idx"
  ON "automation_secrets"("projectId", "archivedAt", "name");

CREATE UNIQUE INDEX "external_http_operations_outboxRecordId_key"
  ON "external_http_operations"("outboxRecordId");
CREATE UNIQUE INDEX "external_http_operations_projectId_id_key"
  ON "external_http_operations"("projectId", "id");
CREATE UNIQUE INDEX "external_http_operations_projectId_outboxRecordId_key"
  ON "external_http_operations"("projectId", "outboxRecordId");
CREATE UNIQUE INDEX "external_http_operations_projectId_scenarioExecutionId_nodeId_key"
  ON "external_http_operations"("projectId", "scenarioExecutionId", "nodeId");
CREATE INDEX "external_http_operations_projectId_scenarioExecutionId_createdAt_idx"
  ON "external_http_operations"("projectId", "scenarioExecutionId", "createdAt");

ALTER TABLE "automation_secrets"
  ADD CONSTRAINT "automation_secrets_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_http_operations"
  ADD CONSTRAINT "external_http_operations_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_http_operations"
  ADD CONSTRAINT "external_http_operations_projectId_outboxRecordId_fkey"
  FOREIGN KEY ("projectId", "outboxRecordId") REFERENCES "outbox_records"("projectId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_http_operations"
  ADD CONSTRAINT "external_http_operations_projectId_scenarioExecutionId_fkey"
  FOREIGN KEY ("projectId", "scenarioExecutionId") REFERENCES "scenario_executions"("projectId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
