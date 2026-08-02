ALTER TYPE "CrmOperationType" ADD VALUE 'FORWARD_MESSAGE_EDIT';
ALTER TYPE "CrmOperationType" ADD VALUE 'FORWARD_CONTACT_SHARE';
ALTER TYPE "CrmOperationType" ADD VALUE 'FORWARD_AUTOMATION_STATE';
ALTER TYPE "NormalizedEventType" ADD VALUE 'MESSAGE_EDITED';
ALTER TYPE "NormalizedEventType" ADD VALUE 'CONTACT_SHARED';
ALTER TYPE "NormalizedEventType" ADD VALUE 'AUTOMATION_STATE';
ALTER TYPE "MessageType" ADD VALUE 'CONTACT';
ALTER TYPE "MessageType" ADD VALUE 'LOCATION';
ALTER TYPE "MessageType" ADD VALUE 'POLL';

CREATE TYPE "ConversationAutomationState" AS ENUM ('AUTO', 'MANUAL', 'PAUSED');
CREATE TYPE "ScheduledMessageStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED');
CREATE TYPE "TelegramMediaGroupStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN');

ALTER TABLE "conversations"
  ADD COLUMN "automationState" "ConversationAutomationState" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "automationResumeAt" TIMESTAMPTZ(3),
  ADD COLUMN "automationReasonCode" TEXT,
  ADD COLUMN "automationRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "idempotency_records" ADD COLUMN "resultSafe" JSONB;

UPDATE "conversations"
SET "automationState" = CASE
  WHEN "automationModeOverride" = 'DISABLED' THEN 'MANUAL'::"ConversationAutomationState"
  ELSE 'AUTO'::"ConversationAutomationState"
END;

CREATE TABLE "scheduled_messages" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channelIdentityId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "outboxRecordId" TEXT NOT NULL,
  "seriesId" TEXT NOT NULL,
  "occurrence" INTEGER NOT NULL DEFAULT 1,
  "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'QUEUED',
  "request" JSONB NOT NULL,
  "timezone" TEXT NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "recurrence" JSONB,
  "cancelledAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_media_groups" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channelIdentityId" TEXT NOT NULL,
  "outboxRecordId" TEXT NOT NULL,
  "status" "TelegramMediaGroupStatus" NOT NULL DEFAULT 'QUEUED',
  "disableNotification" BOOLEAN NOT NULL DEFAULT false,
  "protectContent" BOOLEAN NOT NULL DEFAULT false,
  "providerMessageIds" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "telegram_media_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_media_group_items" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mediaGroupId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "kind" "MessageTemplateKind" NOT NULL,
  "caption" TEXT,
  "entities" JSONB,
  "hasSpoiler" BOOLEAN NOT NULL DEFAULT false,
  "providerMessageId" TEXT,
  CONSTRAINT "telegram_media_group_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_bot_interfaces" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "outboxRecordId" TEXT,
  "commands" JSONB NOT NULL DEFAULT '[]',
  "commandScope" JSONB NOT NULL DEFAULT '{"type":"default"}',
  "languageCode" TEXT NOT NULL DEFAULT '',
  "menuButton" JSONB NOT NULL DEFAULT '{"type":"default"}',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "telegram_bot_interfaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_messages_projectId_id_key" ON "scheduled_messages"("projectId", "id");
CREATE UNIQUE INDEX "scheduled_messages_messageId_key" ON "scheduled_messages"("messageId");
CREATE UNIQUE INDEX "scheduled_messages_outboxRecordId_key" ON "scheduled_messages"("outboxRecordId");
CREATE UNIQUE INDEX "scheduled_messages_projectId_messageId_key" ON "scheduled_messages"("projectId", "messageId");
CREATE UNIQUE INDEX "scheduled_messages_projectId_outboxRecordId_key" ON "scheduled_messages"("projectId", "outboxRecordId");
CREATE UNIQUE INDEX "scheduled_messages_projectId_seriesId_occurrence_key" ON "scheduled_messages"("projectId", "seriesId", "occurrence");
CREATE INDEX "scheduled_messages_projectId_status_scheduledAt_idx" ON "scheduled_messages"("projectId", "status", "scheduledAt");
CREATE INDEX "scheduled_messages_projectId_connectionId_status_idx" ON "scheduled_messages"("projectId", "connectionId", "status");

CREATE UNIQUE INDEX "telegram_media_groups_projectId_id_key" ON "telegram_media_groups"("projectId", "id");
CREATE UNIQUE INDEX "telegram_media_groups_outboxRecordId_key" ON "telegram_media_groups"("outboxRecordId");
CREATE UNIQUE INDEX "telegram_media_groups_projectId_outboxRecordId_key" ON "telegram_media_groups"("projectId", "outboxRecordId");
CREATE INDEX "telegram_media_groups_projectId_connectionId_status_idx" ON "telegram_media_groups"("projectId", "connectionId", "status");

CREATE UNIQUE INDEX "telegram_media_group_items_projectId_id_key" ON "telegram_media_group_items"("projectId", "id");
CREATE UNIQUE INDEX "telegram_media_group_items_projectId_mediaGroupId_position_key" ON "telegram_media_group_items"("projectId", "mediaGroupId", "position");
CREATE INDEX "telegram_media_group_items_projectId_mediaAssetId_idx" ON "telegram_media_group_items"("projectId", "mediaAssetId");

CREATE UNIQUE INDEX "telegram_bot_interfaces_projectId_id_key" ON "telegram_bot_interfaces"("projectId", "id");
CREATE UNIQUE INDEX "telegram_bot_interfaces_outboxRecordId_key" ON "telegram_bot_interfaces"("outboxRecordId");
CREATE UNIQUE INDEX "telegram_bot_interfaces_projectId_connectionId_key" ON "telegram_bot_interfaces"("projectId", "connectionId");
CREATE UNIQUE INDEX "telegram_bot_interfaces_projectId_outboxRecordId_key" ON "telegram_bot_interfaces"("projectId", "outboxRecordId");

ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_projectId_channelIdentityId_fkey" FOREIGN KEY ("projectId", "channelIdentityId") REFERENCES "channel_identities"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_projectId_messageId_fkey" FOREIGN KEY ("projectId", "messageId") REFERENCES "messages"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_projectId_outboxRecordId_fkey" FOREIGN KEY ("projectId", "outboxRecordId") REFERENCES "outbox_records"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "telegram_media_groups" ADD CONSTRAINT "telegram_media_groups_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_media_groups" ADD CONSTRAINT "telegram_media_groups_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_media_groups" ADD CONSTRAINT "telegram_media_groups_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_media_groups" ADD CONSTRAINT "telegram_media_groups_projectId_channelIdentityId_fkey" FOREIGN KEY ("projectId", "channelIdentityId") REFERENCES "channel_identities"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_media_groups" ADD CONSTRAINT "telegram_media_groups_projectId_outboxRecordId_fkey" FOREIGN KEY ("projectId", "outboxRecordId") REFERENCES "outbox_records"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_media_group_items" ADD CONSTRAINT "telegram_media_group_items_projectId_mediaGroupId_fkey" FOREIGN KEY ("projectId", "mediaGroupId") REFERENCES "telegram_media_groups"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_media_group_items" ADD CONSTRAINT "telegram_media_group_items_projectId_mediaAssetId_fkey" FOREIGN KEY ("projectId", "mediaAssetId") REFERENCES "media_assets"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "telegram_bot_interfaces" ADD CONSTRAINT "telegram_bot_interfaces_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_bot_interfaces" ADD CONSTRAINT "telegram_bot_interfaces_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_bot_interfaces" ADD CONSTRAINT "telegram_bot_interfaces_projectId_outboxRecordId_fkey" FOREIGN KEY ("projectId", "outboxRecordId") REFERENCES "outbox_records"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_occurrence_check" CHECK ("occurrence" > 0);
ALTER TABLE "telegram_media_group_items" ADD CONSTRAINT "telegram_media_group_items_position_check" CHECK ("position" >= 0 AND "position" < 10);
