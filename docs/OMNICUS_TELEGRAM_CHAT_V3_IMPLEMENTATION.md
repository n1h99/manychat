# Omnicus response to Telegram Chat v3 contract gaps

Status: implemented provider contracts 3.0.0-3.2.0, 2026-08-02

Input: Cyber Pulse `OMNICUS_TELEGRAM_CHAT_V3_GAPS.md`, based on Omnicus
baseline `4345938027ccf0b323bff1a41b4799b0e28bf2d2`.

Authoritative provider reference: Telegram Bot API 10.2, reviewed on
2026-08-02 at `https://core.telegram.org/bots/api` and
`https://core.telegram.org/bots/api-changelog`.

## Released in contracts 3.0.0 through 3.2.0

The authoritative CRM-to-Omnicus contract is
`OMNICUS_CRM_OUTBOUND_OPENAPI.yaml` 3.2.0.

| Gap | Released behavior                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- |
| G01 | Project/connection/identity-scoped capability discovery                                                           |
| G02 | Durable text/caption/inline-keyboard edit and message delete                                                      |
| G04 | UTF-16 entities, quote, link-preview options, protected content and message effects on ordinary outbound messages |
| G05 | Durable set/change/remove manager reaction                                                                        |
| G06 | Ephemeral typing/record/upload chat actions                                                                       |
| G11 | Conversation AUTO/MANUAL/PAUSED control with revision concurrency and automatic resume                            |
| G12 | Explicit idempotent retry of terminal FAILED; UNKNOWN is rejected                                                 |
| G14 | Durable pin/unpin                                                                                                 |
| G15 | Private-chat 30-second `sendMessageDraft` preview updates                                                         |
| G03 | Static, animated and video stickers; media spoilers for photo, video and animation                                |
| V32 | Safe source context, inbound message edits and explicit contact-share events                                      |
| V32 | One-shot scheduling, durable media-group aggregate, structured messages and bot commands/menu                     |

The capability response explicitly publishes `quote`, `linkPreviewOptions`
and `explicitRetry`. CRM must gate these features by those keys rather than
inferring support from the presence of request fields or paths.

Durable changes use `OutboxRecord`, stable job IDs, leases, retry/backoff and
reconciliation. Provider success updates safe message metadata only after the
lease-owning worker commits. Ephemeral actions never create a Message or
OutboxRecord and are never represented as delivered content.

## Provider restrictions encoded as capabilities

- Telegram Bot API supports one non-paid bot reaction per message. Custom emoji
  eligibility is still decided by Telegram.
- Message deletion is generally limited to messages younger than 48 hours and
  depends on chat permissions. Bot API does not provide a general message
  deletion update, so external deletion synchronization is unsupported.
- Message effects are private-chat only. Bot API exposes no effect catalog to
  bots, so `availableEffects` is empty with
  `BOT_API_EFFECT_CATALOG_UNAVAILABLE`; known IDs remain pass-through only.
- `sendChatAction` lasts at most five seconds.
- `sendMessageDraft` is a private-chat, ephemeral 30-second preview. Empty text
  is ignored because Telegram renders it as a Thinking placeholder rather than
  cancellation. The final content must be sent with the durable outbound
  message endpoint.
- Edit capability limits explicitly list text, caption, entities, inline
  keyboard and link-preview options as editable. Protected-content, message
  effect, reply and quote state are immutable and preserved.
- Telegram's scheduled-message API is not a Bot API facility. Omnicus 3.2.0
  provides an application-owned one-shot PostgreSQL/outbox scheduler instead.
- Scheduled create/get/list/cancel responses include `connectionId`,
  `channelIdentityId`, `omnicusContactId` and nullable `crmLeadId`. Public
  get/list/cancel calls require connection and contact scope, while optional
  identity/lead filters prevent a leaked schedule UUID from crossing lead
  boundaries. Stored request JSON and message content are not returned.

Contract 3.1.0 adds `STICKER` as a first-class media kind. Static WEBP,
animated TGS and video WEBM uploads are checked against format-specific size
limits before Telegram is called. Stickers never accept captions. Inbound
photo, video and animation events preserve `hasSpoiler`; inbound media also
preserves `mediaGroupId` so CRM can group existing Telegram albums without
mistaking that metadata for an outbound album operation.

## Still disabled in 3.2.0

Capability discovery returns `supported=false` with a stable reason code for:

- G05 inbound user-reaction advertisement remains disabled until the published
  Omnicus-to-CRM reaction endpoint passes live E2E; normalization, persistence
  and transactional delivery are implemented;
- G09 reply keyboards and Force Reply;
- G13 external action callbacks;
- recurring schedules, rich-message blocks and media-rich streaming drafts.

CRM must not infer or enable an absent/false capability. These remaining groups
need their persistence, inbound event model and recovery semantics completed
before their OpenAPI paths are published.

## Security and isolation

- The CRM outbound bearer credential remains distinct from the Omnicus-to-CRM
  credential.
- Every durable target is resolved from an Omnicus message UUID inside the
  authenticated project, connection, channel identity and contact scope.
- A caller cannot supply a Telegram chat ID or provider message ID.
- Bot tokens are decrypted only immediately before the Telegram request.
- Telegram payloads, message bodies, tokens and ciphertext are absent from
  structured logs and audit metadata.
