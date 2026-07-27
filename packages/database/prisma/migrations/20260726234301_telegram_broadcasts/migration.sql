-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PREPARING', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "audience" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "pausedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channelIdentityId" TEXT NOT NULL,
    "messageId" TEXT,
    "outboxRecordId" TEXT,
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "queuedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "channelConnectionId" TEXT,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcasts_projectId_status_scheduledAt_idx" ON "broadcasts"("projectId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "broadcasts_projectId_connectionId_status_idx" ON "broadcasts"("projectId", "connectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "broadcasts_projectId_id_key" ON "broadcasts"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "broadcasts_projectId_name_key" ON "broadcasts"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_messageId_key" ON "broadcast_recipients"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_outboxRecordId_key" ON "broadcast_recipients"("outboxRecordId");

-- CreateIndex
CREATE INDEX "broadcast_recipients_projectId_broadcastId_status_idx" ON "broadcast_recipients"("projectId", "broadcastId", "status");

-- CreateIndex
CREATE INDEX "broadcast_recipients_projectId_channelIdentityId_idx" ON "broadcast_recipients"("projectId", "channelIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_projectId_id_key" ON "broadcast_recipients"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_projectId_broadcastId_channelIdentityI_key" ON "broadcast_recipients"("projectId", "broadcastId", "channelIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_projectId_messageId_key" ON "broadcast_recipients"("projectId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_projectId_outboxRecordId_key" ON "broadcast_recipients"("projectId", "outboxRecordId");

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_projectId_broadcastId_fkey" FOREIGN KEY ("projectId", "broadcastId") REFERENCES "broadcasts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_projectId_channelIdentityId_fkey" FOREIGN KEY ("projectId", "channelIdentityId") REFERENCES "channel_identities"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_projectId_messageId_fkey" FOREIGN KEY ("projectId", "messageId") REFERENCES "messages"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_projectId_outboxRecordId_fkey" FOREIGN KEY ("projectId", "outboxRecordId") REFERENCES "outbox_records"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "channel_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
