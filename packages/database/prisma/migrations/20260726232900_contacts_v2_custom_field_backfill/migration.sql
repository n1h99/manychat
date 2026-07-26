-- Backfill the typed query projection from the Stage 2 canonical JSON document.
-- Values were already validated by CustomFieldDefinition at write time; the
-- explicit JSON type guards keep the migration safe for any legacy fixtures.
INSERT INTO "contact_custom_field_values" (
  "id", "projectId", "contactId", "definitionId", "valueJson", "valueText",
  "valueNumber", "valueBoolean", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  c."projectId",
  c."id",
  d."id",
  c."customFields" -> d."key",
  CASE
    WHEN d."type" IN ('TEXT', 'SELECT', 'DATE', 'DATETIME')
      AND jsonb_typeof(c."customFields" -> d."key") = 'string'
    THEN c."customFields" ->> d."key"
    ELSE NULL
  END,
  CASE
    WHEN d."type" = 'NUMBER' AND jsonb_typeof(c."customFields" -> d."key") = 'number'
    THEN (c."customFields" ->> d."key")::DECIMAL(30, 10)
    ELSE NULL
  END,
  CASE
    WHEN d."type" = 'BOOLEAN' AND jsonb_typeof(c."customFields" -> d."key") = 'boolean'
    THEN (c."customFields" ->> d."key")::BOOLEAN
    ELSE NULL
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "contacts" c
JOIN "custom_field_definitions" d
  ON d."projectId" = c."projectId"
  AND d."archivedAt" IS NULL
  AND c."customFields" ? d."key"
ON CONFLICT ("projectId", "contactId", "definitionId") DO NOTHING;
