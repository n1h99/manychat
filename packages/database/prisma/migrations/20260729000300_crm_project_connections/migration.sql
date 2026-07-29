-- Per-project CRM connection registry. Existing rows remain usable through the
-- bounded environment fallback until they are paired through the application.
CREATE TYPE "CrmProvider" AS ENUM ('CYBER_PULSE');
CREATE TYPE "CrmConnectionStatus" AS ENUM ('DRAFT', 'PAIRING', 'ACTIVE', 'DISABLED', 'ERROR');

ALTER TABLE "crm_project_configs"
ADD COLUMN "provider" "CrmProvider" NOT NULL DEFAULT 'CYBER_PULSE',
ADD COLUMN "status" "CrmConnectionStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "baseUrl" TEXT,
ADD COLUMN "credentialsEncrypted" JSONB,
ADD COLUMN "inboundTokenHash" TEXT,
ADD COLUMN "pairingCodeHash" TEXT,
ADD COLUMN "pairingExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN "capabilities" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "lastTestedAt" TIMESTAMPTZ(3),
ADD COLUMN "lastErrorAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "crm_project_configs_inboundTokenHash_key"
ON "crm_project_configs"("inboundTokenHash");

CREATE UNIQUE INDEX "crm_project_configs_pairingCodeHash_key"
ON "crm_project_configs"("pairingCodeHash");

CREATE UNIQUE INDEX "crm_project_configs_provider_crmProjectId_key"
ON "crm_project_configs"("provider", "crmProjectId");

CREATE INDEX "crm_project_configs_status_pairingExpiresAt_idx"
ON "crm_project_configs"("status", "pairingExpiresAt");
