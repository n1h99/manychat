-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContactStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "ContactStatus" ADD VALUE 'UNSUBSCRIBED';
ALTER TYPE "ContactStatus" ADD VALUE 'MERGED';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "mergedIntoContactId" TEXT;

-- CreateTable
CREATE TABLE "contact_custom_field_values" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL(30,10),
    "valueBoolean" BOOLEAN,
    "valueDateTime" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filterSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "filter" JSONB NOT NULL,
    "status" "SegmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_custom_field_values_projectId_definitionId_valueTex_idx" ON "contact_custom_field_values"("projectId", "definitionId", "valueText");

-- CreateIndex
CREATE INDEX "contact_custom_field_values_projectId_definitionId_valueNum_idx" ON "contact_custom_field_values"("projectId", "definitionId", "valueNumber");

-- CreateIndex
CREATE INDEX "contact_custom_field_values_projectId_definitionId_valueDat_idx" ON "contact_custom_field_values"("projectId", "definitionId", "valueDateTime");

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_field_values_projectId_id_key" ON "contact_custom_field_values"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_field_values_projectId_contactId_definitionI_key" ON "contact_custom_field_values"("projectId", "contactId", "definitionId");

-- CreateIndex
CREATE INDEX "segments_projectId_status_updatedAt_idx" ON "segments"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "segments_projectId_id_key" ON "segments"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "segments_projectId_name_key" ON "segments"("projectId", "name");

-- CreateIndex
CREATE INDEX "contacts_projectId_mergedIntoContactId_idx" ON "contacts"("projectId", "mergedIntoContactId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_projectId_mergedIntoContactId_fkey" FOREIGN KEY ("projectId", "mergedIntoContactId") REFERENCES "contacts"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_projectId_contactId_fkey" FOREIGN KEY ("projectId", "contactId") REFERENCES "contacts"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_projectId_definitionId_fkey" FOREIGN KEY ("projectId", "definitionId") REFERENCES "custom_field_definitions"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
