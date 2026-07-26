-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "RawWebhookEventStatus" AS ENUM ('RECEIVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InboxRecordStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'RETRY', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "OutboxRecordStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NormalizedEventType" AS ENUM ('MESSAGE', 'COMMAND', 'PHOTO', 'DOCUMENT', 'CALLBACK_QUERY', 'CHAT_MEMBER', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChannelIdentityStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'COMMAND', 'PHOTO', 'DOCUMENT', 'CALLBACK_QUERY', 'SYSTEM', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'RECEIVED', 'PROCESSING', 'SENT', 'FAILED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "channel_identities"
  ADD COLUMN "languageCode" TEXT,
  ADD COLUMN "status" "ChannelIdentityStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "channel_connections" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "ChannelType" NOT NULL DEFAULT 'TELEGRAM',
  "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'DRAFT',
  "credentialsEncrypted" JSONB NOT NULL,
  "webhookSecretEncrypted" JSONB NOT NULL,
  "botUsername" TEXT,
  "externalBotId" TEXT,
  "webhookMetadata" JSONB,
  "lastWebhookAt" TIMESTAMPTZ(3),
  "lastErrorAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_webhook_events" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalUpdateId" TEXT NOT NULL,
  "status" "RawWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purgeAfter" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "raw_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_records" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "rawWebhookEventId" TEXT NOT NULL,
  "status" "InboxRecordStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "lockedAt" TIMESTAMPTZ(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inbox_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normalized_events" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "inboxRecordId" TEXT NOT NULL,
  "type" "NormalizedEventType" NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "normalized_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "externalChatId" TEXT NOT NULL,
  "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "normalizedEventId" TEXT,
  "direction" "MessageDirection" NOT NULL,
  "type" "MessageType" NOT NULL,
  "status" "MessageStatus" NOT NULL,
  "externalMessageId" TEXT,
  "content" JSONB NOT NULL,
  "metadata" JSONB,
  "sentAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_records" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "OutboxRecordStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "lockedAt" TIMESTAMPTZ(3),
  "lockedBy" TEXT,
  "lastError" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outbox_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3),
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_projectId_id_key" ON "channel_connections"("projectId", "id");
CREATE INDEX "channel_connections_projectId_status_idx" ON "channel_connections"("projectId", "status");
CREATE INDEX "channel_connections_projectId_type_idx" ON "channel_connections"("projectId", "type");
CREATE UNIQUE INDEX "raw_webhook_events_projectId_id_key" ON "raw_webhook_events"("projectId", "id");
CREATE UNIQUE INDEX "raw_webhook_events_connectionId_externalUpdateId_key" ON "raw_webhook_events"("connectionId", "externalUpdateId");
CREATE INDEX "raw_webhook_events_projectId_connectionId_receivedAt_idx" ON "raw_webhook_events"("projectId", "connectionId", "receivedAt");
CREATE INDEX "raw_webhook_events_projectId_purgeAfter_idx" ON "raw_webhook_events"("projectId", "purgeAfter");
CREATE UNIQUE INDEX "inbox_records_rawWebhookEventId_key" ON "inbox_records"("rawWebhookEventId");
CREATE UNIQUE INDEX "inbox_records_projectId_id_key" ON "inbox_records"("projectId", "id");
CREATE UNIQUE INDEX "inbox_records_projectId_rawWebhookEventId_key" ON "inbox_records"("projectId", "rawWebhookEventId");
CREATE INDEX "inbox_records_status_nextAttemptAt_idx" ON "inbox_records"("status", "nextAttemptAt");
CREATE INDEX "inbox_records_projectId_connectionId_status_idx" ON "inbox_records"("projectId", "connectionId", "status");
CREATE UNIQUE INDEX "normalized_events_inboxRecordId_key" ON "normalized_events"("inboxRecordId");
CREATE UNIQUE INDEX "normalized_events_projectId_id_key" ON "normalized_events"("projectId", "id");
CREATE UNIQUE INDEX "normalized_events_projectId_inboxRecordId_key" ON "normalized_events"("projectId", "inboxRecordId");
CREATE INDEX "normalized_events_projectId_connectionId_createdAt_idx" ON "normalized_events"("projectId", "connectionId", "createdAt");
CREATE UNIQUE INDEX "conversations_projectId_id_key" ON "conversations"("projectId", "id");
CREATE UNIQUE INDEX "conversations_projectId_connectionId_externalChatId_key" ON "conversations"("projectId", "connectionId", "externalChatId");
CREATE INDEX "conversations_projectId_connectionId_status_idx" ON "conversations"("projectId", "connectionId", "status");
CREATE INDEX "conversations_projectId_contactId_updatedAt_idx" ON "conversations"("projectId", "contactId", "updatedAt");
CREATE UNIQUE INDEX "messages_projectId_id_key" ON "messages"("projectId", "id");
CREATE UNIQUE INDEX "messages_projectId_normalizedEventId_key" ON "messages"("projectId", "normalizedEventId");
CREATE UNIQUE INDEX "messages_connectionId_direction_externalMessageId_key" ON "messages"("connectionId", "direction", "externalMessageId");
CREATE INDEX "messages_projectId_conversationId_createdAt_idx" ON "messages"("projectId", "conversationId", "createdAt");
CREATE INDEX "messages_projectId_connectionId_externalMessageId_idx" ON "messages"("projectId", "connectionId", "externalMessageId");
CREATE UNIQUE INDEX "outbox_records_projectId_id_key" ON "outbox_records"("projectId", "id");
CREATE UNIQUE INDEX "outbox_records_projectId_idempotencyKey_key" ON "outbox_records"("projectId", "idempotencyKey");
CREATE INDEX "outbox_records_status_nextAttemptAt_idx" ON "outbox_records"("status", "nextAttemptAt");
CREATE INDEX "outbox_records_projectId_connectionId_status_idx" ON "outbox_records"("projectId", "connectionId", "status");
CREATE UNIQUE INDEX "idempotency_records_projectId_scope_key_key" ON "idempotency_records"("projectId", "scope", "key");
CREATE INDEX "idempotency_records_projectId_expiresAt_idx" ON "idempotency_records"("projectId", "expiresAt");

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "raw_webhook_events" ADD CONSTRAINT "raw_webhook_events_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbox_records" ADD CONSTRAINT "inbox_records_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbox_records" ADD CONSTRAINT "inbox_records_projectId_rawWebhookEventId_fkey" FOREIGN KEY ("projectId", "rawWebhookEventId") REFERENCES "raw_webhook_events"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "normalized_events" ADD CONSTRAINT "normalized_events_projectId_inboxRecordId_fkey" FOREIGN KEY ("projectId", "inboxRecordId") REFERENCES "inbox_records"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_conversationId_fkey" FOREIGN KEY ("projectId", "conversationId") REFERENCES "conversations"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_normalizedEventId_fkey" FOREIGN KEY ("projectId", "normalizedEventId") REFERENCES "normalized_events"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_records" ADD CONSTRAINT "outbox_records_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
