ALTER TYPE "OutboxKind" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "NormalizedEventType" ADD VALUE IF NOT EXISTS 'INTERACTIVE';
ALTER TYPE "NormalizedEventType" ADD VALUE IF NOT EXISTS 'MESSAGE_STATUS';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'INTERACTIVE';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'READ';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'DELETED';
ALTER TYPE "MediaAssetSource" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "CrmOperationType" ADD VALUE IF NOT EXISTS 'FORWARD_MESSAGE_STATUS';

CREATE TYPE "WhatsAppTemplateStatus" AS ENUM (
  'APPROVED',
  'PENDING',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'UNKNOWN'
);

CREATE TYPE "WhatsAppTemplateCategory" AS ENUM (
  'AUTHENTICATION',
  'MARKETING',
  'UTILITY',
  'UNKNOWN'
);

CREATE TYPE "WhatsAppTemplateQuality" AS ENUM (
  'GREEN',
  'YELLOW',
  'RED',
  'UNKNOWN'
);

ALTER TABLE "channel_connections"
  ADD COLUMN "providerAccountId" TEXT,
  ADD COLUMN "providerIdentityId" TEXT,
  ALTER COLUMN "webhookSecretEncrypted" DROP NOT NULL;

ALTER TABLE "conversations"
  ADD COLUMN "lastInboundAt" TIMESTAMPTZ(3),
  ADD COLUMN "serviceWindowExpiresAt" TIMESTAMPTZ(3);

CREATE TABLE "message_status_events" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "normalizedEventId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "status" "MessageStatus" NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_status_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_message_templates" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "providerTemplateId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL,
  "status" "WhatsAppTemplateStatus" NOT NULL,
  "category" "WhatsAppTemplateCategory" NOT NULL,
  "components" JSONB NOT NULL,
  "quality" "WhatsAppTemplateQuality" NOT NULL,
  "rejectionReasonCode" TEXT,
  "lastSyncedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "whatsapp_message_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_connections_type_providerIdentityId_key"
  ON "channel_connections"("type", "providerIdentityId");
CREATE INDEX "channel_connections_type_providerAccountId_status_idx"
  ON "channel_connections"("type", "providerAccountId", "status");
CREATE INDEX "conversations_projectId_connectionId_serviceWindowExpiresAt_idx"
  ON "conversations"("projectId", "connectionId", "serviceWindowExpiresAt");

CREATE UNIQUE INDEX "message_status_events_normalizedEventId_key"
  ON "message_status_events"("normalizedEventId");
CREATE UNIQUE INDEX "message_status_events_projectId_id_key"
  ON "message_status_events"("projectId", "id");
CREATE UNIQUE INDEX "message_status_events_projectId_normalizedEventId_key"
  ON "message_status_events"("projectId", "normalizedEventId");
CREATE UNIQUE INDEX "message_status_events_projectId_connectionId_providerEventId_key"
  ON "message_status_events"("projectId", "connectionId", "providerEventId");
CREATE INDEX "message_status_events_projectId_messageId_occurredAt_idx"
  ON "message_status_events"("projectId", "messageId", "occurredAt");

CREATE UNIQUE INDEX "whatsapp_message_templates_projectId_id_key"
  ON "whatsapp_message_templates"("projectId", "id");
CREATE UNIQUE INDEX "whatsapp_message_templates_projectId_connectionId_providerTemplateId_key"
  ON "whatsapp_message_templates"("projectId", "connectionId", "providerTemplateId");
CREATE UNIQUE INDEX "whatsapp_message_templates_projectId_connectionId_name_languageCode_key"
  ON "whatsapp_message_templates"("projectId", "connectionId", "name", "languageCode");
CREATE INDEX "whatsapp_message_templates_projectId_connectionId_status_name_idx"
  ON "whatsapp_message_templates"("projectId", "connectionId", "status", "name");

ALTER TABLE "message_status_events"
  ADD CONSTRAINT "message_status_events_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "message_status_events_projectId_connectionId_fkey"
  FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "message_status_events_projectId_messageId_fkey"
  FOREIGN KEY ("projectId", "messageId") REFERENCES "messages"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "message_status_events_projectId_normalizedEventId_fkey"
  FOREIGN KEY ("projectId", "normalizedEventId") REFERENCES "normalized_events"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_message_templates"
  ADD CONSTRAINT "whatsapp_message_templates_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "whatsapp_message_templates_projectId_connectionId_fkey"
  FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
