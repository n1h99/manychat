# Cyber Pulse CRM integration

## Verified contract

The production adapter is based on the Cyber Pulse staging backend contract:

- backend commit: `48c0d6b98aef09bd051a340e091078963014558b`;
- authoritative source: `cyber-pulse-back/docs/omnicus-openapi.yaml`;
- staging origin: `https://cyber-pulse-back-staging.up.railway.app`;
- public CRM project identifier: `cyber-pulse-staging`;
- reviewed on: 2026-07-29.

Omnicus calls only these CRM endpoints:

```text
POST /integrations/v1/omnicus/leads/upsert
POST /integrations/v1/omnicus/messages/inbound
GET  /integrations/v1/omnicus/operations?crmProjectId=...&idempotencyKey=...
```

Every request uses service Bearer authentication and a correlation ID. Mutating
requests also include the durable Omnicus outbox ID as `Idempotency-Key`.

The adapter sends normalized Omnicus data, never Telegram webhook payloads,
provider credentials or encrypted secret envelopes. When an inbound Telegram
file can be materialized, `media.downloadUrl` is a private signed URL with a
short expiry. It exists only in the outbound request and is never persisted by
Omnicus. CRM must download it immediately and store its own copy.

## Direction: Omnicus to CRM

The worker is enabled with:

```text
CRM_INTEGRATION_ENABLED=true
CRM_BASE_URL=https://cyber-pulse-back-staging.up.railway.app
CRM_AUTH_TOKEN=<Cyber Pulse OMNICUS_INBOUND_AUTH_TOKEN value>
```

`CRM_AUTH_TOKEN` is required only in the worker and is never stored in
PostgreSQL. `CrmProjectConfig.crmProjectId` selects the CRM project for each
Omnicus project.

The PostgreSQL outbox remains the source of truth. A request timeout is
reconciled by idempotency key. If reconciliation cannot determine the result,
the outbox becomes `UNKNOWN`; it is not blindly retried.

## Direction: CRM to Omnicus

Cyber Pulse calls the contract in
`docs/OMNICUS_CRM_OUTBOUND_OPENAPI.yaml`. This direction uses an independent
credential:

```text
CRM_INBOUND_ENABLED=true
CRM_INBOUND_AUTH_TOKEN=<different random service token>
```

The API validates the configured `crmProjectId` to `omnicusProjectId` mapping,
contact, channel identity and connection before creating a Telegram
`Message`/`OutboxRecord` transaction. Redis enqueue failure does not remove the
PostgreSQL intent. The existing Telegram outbound recovery worker eventually
enqueues it.

The create response means `QUEUED`, not `SENT`. Cyber Pulse reconciles the
operation endpoint before displaying a delivery result.

CRM uploads outbound files first through
`POST /integrations/v1/crm/media`, then references the returned
`mediaAssetId` from `POST /integrations/v1/crm/messages/outbound`. Replies use
an Omnicus message UUID, not a Telegram provider message ID. Inline keyboard
callbacks are provider-independent `{text, callbackData}` values.

## Live acceptance gate

Code and mock-backed contract tests do not constitute live acceptance. Before
legacy CRM cleanup, verify on staging:

1. Telegram contact creates one CRM lead.
2. A repeated lead operation is idempotent.
3. An inbound Telegram message appears once in CRM.
4. CRM queues a reply and reconciles it to `SENT`.
5. A forced timeout is reconciled without duplicate side effects.
6. Available media is downloaded from its short-lived URL and stored by CRM;
   expired/unavailable files remain metadata-only with a safe status.
7. Neither service logs either service token or message payload.
