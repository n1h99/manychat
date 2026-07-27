-- DropIndex
DROP INDEX "message_template_versions_projectId_templateId_contentHash_key";

-- CreateIndex
CREATE INDEX "message_template_versions_projectId_templateId_contentHash_idx" ON "message_template_versions"("projectId", "templateId", "contentHash");
