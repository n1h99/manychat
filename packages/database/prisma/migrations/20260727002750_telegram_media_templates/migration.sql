-- CreateEnum
CREATE TYPE "MediaAssetSource" AS ENUM ('USER_UPLOAD', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('PROVIDER_REFERENCE', 'PENDING_UPLOAD', 'AVAILABLE', 'REJECTED', 'UNAVAILABLE', 'DELETED');

-- CreateEnum
CREATE TYPE "MessageTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MessageTemplateKind" AS ENUM ('TEXT', 'PHOTO', 'DOCUMENT');

-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN     "templateVersionId" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "mediaAssetId" TEXT;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT,
    "source" "MediaAssetSource" NOT NULL,
    "kind" "MessageTemplateKind" NOT NULL,
    "status" "MediaAssetStatus" NOT NULL,
    "providerMediaId" TEXT,
    "providerMediaUniqueId" TEXT,
    "providerMetadata" JSONB,
    "bucketKey" TEXT,
    "originalFilename" TEXT,
    "detectedMimeType" TEXT,
    "declaredMimeType" TEXT,
    "extension" TEXT,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "retentionUntil" TIMESTAMPTZ(3),
    "availableAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MessageTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "activeVersionId" TEXT,
    "draftVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template_versions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "MessageTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "MessageTemplateKind" NOT NULL,
    "content" JSONB NOT NULL,
    "mediaAssetId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "contentHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "message_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_bucketKey_key" ON "media_assets"("bucketKey");

-- CreateIndex
CREATE INDEX "media_assets_projectId_status_retentionUntil_idx" ON "media_assets"("projectId", "status", "retentionUntil");

-- CreateIndex
CREATE INDEX "media_assets_projectId_connectionId_providerMediaId_idx" ON "media_assets"("projectId", "connectionId", "providerMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_projectId_id_key" ON "media_assets"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_projectId_connectionId_providerMediaId_key" ON "media_assets"("projectId", "connectionId", "providerMediaId");

-- CreateIndex
CREATE INDEX "message_templates_projectId_status_updatedAt_idx" ON "message_templates"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_projectId_id_key" ON "message_templates"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_projectId_name_key" ON "message_templates"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_projectId_id_activeVersionId_key" ON "message_templates"("projectId", "id", "activeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_projectId_id_draftVersionId_key" ON "message_templates"("projectId", "id", "draftVersionId");

-- CreateIndex
CREATE INDEX "message_template_versions_projectId_templateId_status_idx" ON "message_template_versions"("projectId", "templateId", "status");

-- CreateIndex
CREATE INDEX "message_template_versions_projectId_mediaAssetId_idx" ON "message_template_versions"("projectId", "mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_versions_projectId_id_key" ON "message_template_versions"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_versions_projectId_templateId_id_key" ON "message_template_versions"("projectId", "templateId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_versions_projectId_templateId_version_key" ON "message_template_versions"("projectId", "templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_versions_projectId_templateId_contentHash_key" ON "message_template_versions"("projectId", "templateId", "contentHash");

-- CreateIndex
CREATE INDEX "broadcasts_projectId_templateVersionId_idx" ON "broadcasts"("projectId", "templateVersionId");

-- CreateIndex
CREATE INDEX "messages_projectId_mediaAssetId_idx" ON "messages"("projectId", "mediaAssetId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_mediaAssetId_fkey" FOREIGN KEY ("projectId", "mediaAssetId") REFERENCES "media_assets"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_projectId_templateVersionId_fkey" FOREIGN KEY ("projectId", "templateVersionId") REFERENCES "message_template_versions"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_projectId_id_activeVersionId_fkey" FOREIGN KEY ("projectId", "id", "activeVersionId") REFERENCES "message_template_versions"("projectId", "templateId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_projectId_id_draftVersionId_fkey" FOREIGN KEY ("projectId", "id", "draftVersionId") REFERENCES "message_template_versions"("projectId", "templateId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_projectId_templateId_fkey" FOREIGN KEY ("projectId", "templateId") REFERENCES "message_templates"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_projectId_mediaAssetId_fkey" FOREIGN KEY ("projectId", "mediaAssetId") REFERENCES "media_assets"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
