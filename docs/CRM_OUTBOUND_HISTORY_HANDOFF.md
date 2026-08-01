# CRM handoff: Omnicus outbound history

## Purpose

Cyber Pulse already receives normalized inbound Telegram events and stores
messages created from its own composer. It must now also store outbound
Telegram messages created by Omnicus automation and broadcasts.

The authoritative request schema is
`docs/OMNICUS_TO_CRM_OPENAPI.yaml`, version `3.1.0`.

## Required endpoint

```text
POST /integrations/v1/omnicus/messages/outbound
Authorization: Bearer <existing Omnicus inbound service token>
Idempotency-Key: <stable Omnicus CRM outbox UUID>
X-Correlation-Id: <safe correlation ID>
Content-Type: application/json
```

The endpoint returns the same result shape as the inbound message endpoint:

```json
{
  "crmLeadId": "...",
  "crmMessageId": "...",
  "mode": "created",
  "operationId": "..."
}
```

`mode` is `created` or `duplicate`. The operation must remain queryable through
the existing reconciliation endpoint by `crmProjectId + Idempotency-Key`.

## Required behavior

- Authenticate with the existing Omnicus-to-CRM credential. Do not reuse the
  CRM-to-Omnicus outbound credential.
- Resolve the tenant by both `crmProjectId` and `omnicusProjectId`.
- Resolve the conversation/lead by `omnicusContactId` and the project-scoped
  identity.
- Deduplicate by both `Idempotency-Key` and stable Omnicus `messageId`.
- Store direction as outbound and preserve `providerMessageId`.
- Preserve `occurredAt`; do not replace it with CRM receipt time.
- Preserve `source`, `scenarioExecutionId`, `broadcastId`, media kind, inline
  keyboard, entities, link-preview options, protected-content state, message
  effect ID, reply target UUID and quote metadata.
- Never store Omnicus signed media URLs. Download an available URL immediately
  into CRM storage and persist the CRM-owned URL/status, using the same guarded
  media ingestion policy as inbound messages.
- A callback may already exist with `interactive.sourceMessageId` equal to this
  message UUID. After inserting the source message, conversation serialization
  must resolve the callback reference preview. This can be dynamic lookup or an
  idempotent backfill.
- An existing outbound message created by the CRM composer must remain a
  duplicate, not be inserted a second time.
- Do not expose raw provider errors or request bodies in logs.

## Required tests

1. service authentication and project isolation;
2. created and duplicate response modes;
3. concurrent identical requests create one message/operation;
4. same `messageId` with a different payload is a conflict;
5. automation text plus callback buttons is stored as outbound;
6. photo/document/audio/video/voice/video-note/animation metadata and guarded
   download behavior;
7. callback-before-source resolves its reference after source insertion;
8. original `occurredAt` ordering;
9. reconciliation returns the stored terminal result;
10. tokens, signed URLs and raw payloads are absent from logs and persisted
    operation metadata.

## Inbound reaction endpoint

Version `3.0.0` also defines:

```text
POST /integrations/v1/omnicus/reactions/inbound
```

The event is idempotent by `normalizedEventId` and the request
`Idempotency-Key`. `messageId` is always the Omnicus UUID of the target message,
never the Telegram provider ID. The CRM must accept add/change/remove as the
complete `oldReactions` and `newReactions` sets. It must preserve project,
connection and identity isolation and tolerate the source history message being
inserted later. Omnicus will keep the advertised `userReactionEvents`
capability disabled until this endpoint is deployed and verified end to end.

## Deployment order

Deploy the CRM endpoint and verify its unauthenticated response is `401` before
deploying the matching Omnicus commit. This prevents historical automation
backfill from reaching a temporary `404` and becoming a terminal failed CRM
outbox operation.
