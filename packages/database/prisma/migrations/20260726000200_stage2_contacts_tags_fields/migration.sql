-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TELEGRAM', 'WHATSAPP', 'INSTAGRAM', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT', 'MULTI_SELECT', 'JSON');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "automationMode" "AutomationMode" NOT NULL DEFAULT 'ENABLED',
    "crmLeadId" TEXT,
    "crmContactId" TEXT,
    "crmManagerId" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "firstInteractionAt" TIMESTAMPTZ(3),
    "lastInteractionAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_identities" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "channel_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "projectId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("projectId", "contactId", "tagId")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_projectId_status_createdAt_idx" ON "contacts"("projectId", "status", "createdAt");
CREATE INDEX "contacts_projectId_lastInteractionAt_idx" ON "contacts"("projectId", "lastInteractionAt");
CREATE INDEX "contacts_projectId_displayName_idx" ON "contacts"("projectId", "displayName");
CREATE INDEX "contacts_projectId_crmLeadId_idx" ON "contacts"("projectId", "crmLeadId");
CREATE UNIQUE INDEX "contacts_projectId_id_key" ON "contacts"("projectId", "id");
CREATE INDEX "channel_identities_projectId_contactId_idx" ON "channel_identities"("projectId", "contactId");
CREATE UNIQUE INDEX "channel_identities_projectId_id_key" ON "channel_identities"("projectId", "id");
CREATE UNIQUE INDEX "channel_identities_projectId_connectionId_externalUserId_key" ON "channel_identities"("projectId", "connectionId", "externalUserId");
CREATE INDEX "tags_projectId_archivedAt_idx" ON "tags"("projectId", "archivedAt");
CREATE UNIQUE INDEX "tags_projectId_id_key" ON "tags"("projectId", "id");
CREATE UNIQUE INDEX "tags_projectId_normalizedName_key" ON "tags"("projectId", "normalizedName");
CREATE INDEX "contact_tags_projectId_tagId_contactId_idx" ON "contact_tags"("projectId", "tagId", "contactId");
CREATE INDEX "custom_field_definitions_projectId_archivedAt_idx" ON "custom_field_definitions"("projectId", "archivedAt");
CREATE UNIQUE INDEX "custom_field_definitions_projectId_id_key" ON "custom_field_definitions"("projectId", "id");
CREATE UNIQUE INDEX "custom_field_definitions_projectId_key_key" ON "custom_field_definitions"("projectId", "key");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_projectId_tagId_fkey" FOREIGN KEY ("projectId", "tagId") REFERENCES "tags"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
