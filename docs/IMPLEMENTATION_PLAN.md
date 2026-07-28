# OMNICUS — implementation plan

## Stage 3C.2 — Telegram channel UI

The protected web shell includes Telegram channel list, create and details routes.
It uses project-scoped channel queries and mutations, never persists plaintext
tokens in browser storage, renders only the backend masked token, and presents
test-message creation as queued rather than delivered.

## Статус

Этапы 0–4 завершены в рамках pilot scope. Этап 5 реализован для
provider-neutral CRM mock: project configuration, transactional CRM outbox и
deterministic mock worker. Реальный deploy, production CRM adapter и live
Telegram acceptance остаются внешними gates.

## Цель pilot

Доказать надёжный поток:

```text
Telegram webhook
→ PostgreSQL inbox
→ normalized event/contact/message
→ minimal automation runtime
→ CRM mock through PostgreSQL outbox
→ mock CRM result/callback
→ Telegram outbound through PostgreSQL outbox
→ execution and audit visibility
```

Pilot включает:

- Auth/RBAC и project isolation;
- projects;
- contacts, tags и custom field definitions;
- Telegram;
- CRM interface и mock adapter;
- узлы Incoming Message, Condition, Create/Update Lead, Forward to CRM,
  Send Message, Add/Remove Tag;
- transactional inbox/outbox;
- execution journal;
- Railway staging deployment.

Pilot не включает WhatsApp, Instagram, broadcasts, Delay, Wait for Reply,
Subflows, полноценный External HTTP Request editor и расширенные media workflows.

## Сквозные требования каждого этапа

- TypeScript strict и runtime validation внешних данных.
- Tenant-safe composite constraints и project access guards.
- Миграция создаётся до применения изменения schema после появления Prisma.
- Любой внешний side effect проходит через OutboxRecord.
- PostgreSQL является источником истины; BullMQ job можно восстановить.
- Correlation ID проходит через inbox, event, execution, CRM mock и outbound.
- Secrets и PII редактируются в logs/fixtures.
- Acceptance tests используют mocks при отсутствии credentials.
- Security, audit и observability baseline реализуются вместе с функцией, а не
  откладываются в отдельный финальный hardening.

## Этап 0. Scaffold и ADR

### Entry criteria

- Глобальная спецификация и обязательные ADR утверждены.
- Node.js/pnpm target versions выбраны перед созданием lockfile.

### Deliverables

- pnpm workspace и Turborepo;
- `apps/web`, `apps/api`, `apps/worker`;
- packages для database, shared, contracts, config, channel core и test fixtures;
- React/Vite/Ant Design shell;
- NestJS API и worker shell;
- PostgreSQL/Redis local Docker Compose;
- Prisma schema без migration до отдельного review generated SQL; guarded seed
  только для dev/test;
- environment validation;
- health live/ready;
- lint/format/typecheck/test/build pipelines;
- CI;
- Railway service commands;
- архитектурные документы и runbook skeleton.

### Обязательные ADR/checkpoints

- ADR-001…ADR-012 из `docs/DECISIONS.md`;
- Node/pnpm/package version pinning;
- Prisma migration ownership/location;
- structured logging library;
- outbox relay polling/notification strategy;
- cookie/CORS deployment topology.

### Verification

- clean install из lockfile;
- format, lint, typecheck, unit smoke, build;
- `prisma validate`;
- Docker Compose health;
- API/worker graceful shutdown;
- no secrets in repository scan.

### Exit criteria

- Все три приложения запускаются как пустые shells.
- PostgreSQL/Redis доступны через validated config.
- CI повторяет локальные проверки.
- Никаких Telegram/CRM business flows ещё нет.

### Результат

- pnpm/Turborepo workspace, три application shells и шесть infrastructure
  packages созданы;
- Prisma schema валидна, generated client создаётся, migration отсутствует;
- Docker Compose, CI и Railway service configuration созданы;
- переход к Этапу 1 требует отдельного явного решения.

## Этап 1. Auth, RBAC и Projects

### Scope

- User, Role, Permission, GlobalUserRole, ProjectMembership;
- access JWT;
- opaque refresh token family, hash storage, rotation и reuse detection;
- CSRF synchronizer token и Origin/Referer checks;
- login/logout/logout-all/reset-password/invite;
- project CRUD и state machine;
- project selector и protected shell;
- audit baseline;
- backend project access и permission guards.

### Key tests

- refresh token plaintext отсутствует в БД/logs;
- повтор использованного refresh token отзывает family;
- state-changing cookie operation без CSRF отклоняется;
- пользователь без membership не видит project;
- cross-project ID в URL/body отклоняется;
- global role не подменяется project role;
- paused/archived project transitions соответствуют state machine.

### Exit criteria

- Два проекта имеют изолированные данные и разные роли одного пользователя.
- Auth и project acceptance criteria выполняются в API и UI.

## Этап 2. Contacts, Tags и Custom Fields

### Scope

- Contact и ChannelIdentity foundation without a provider connection or webhook runtime;
- automation mode inheritance;
- Tag/ContactTag;
- CustomFieldDefinition и typed value validation. Contact values remain in the contact JSON document in this slice; deleting a definition archives it and never deletes historical contact JSON values;
- Segment schema и validator; UI saved segments можно отложить до последующей
  функции, но модель не должна блокировать развитие;
- contact list/card/filter;
- basic timeline;
- merge policy foundation;
- ChannelConsent foundation.

### Key tests

- tenant-safe foreign keys отклоняют cross-project ContactTag/Identity;
- normalized tag uniqueness;
- custom value соответствует definition type;
- conversation override имеет приоритет над contact mode;
- merge не выполняется автоматически по имени.

### Exit criteria

- Contacts/tags/custom fields работают на fixtures.
- Project isolation подтверждена integration tests.

## Этап 3. Transactional Inbox/Outbox и Telegram Adapter

### Stage 3B.1 — persistence schema

Implemented persistence-only slice: `ChannelConnection`, valid raw webhook
events, `InboxRecord`, `OutboxRecord`, `IdempotencyRecord`, `NormalizedEvent`,
`Conversation` and `Message`, with a separate reviewed migration. This slice
does not include a webhook endpoint, BullMQ processing, outbound delivery, a
channel-management API or frontend. Those remain subsequent Stage 3 work.

Stage 3B.2 adds the public Telegram webhook acknowledgement boundary: it
verifies the encrypted webhook secret before persisting any body, atomically
stores a valid `RawWebhookEvent` and pending `InboxRecord`, deduplicates on the
provider update ID, and best-effort enqueues an inbox-record-only BullMQ job.
Redis enqueue failure does not roll back PostgreSQL intent; recovery remains a
later Stage 3 slice.

Stage 3B.3a adds the Telegram inbound consumer only. It claims one inbox record
with a bounded lease, parses its PostgreSQL-backed payload, and transactionally
persists the normalized event, connection-scoped contact identity, stable
conversation, and inbound message. Redelivery is safe through the unique inbox
event and message constraints.

Stage 3B.3b completes inbound reliability. The worker classifies failures into
safe retryable or permanent codes, applies capped exponential retry delay with
bounded jitter, and terminally dead-letters permanent or exhausted records
without deleting the raw event. Its recovery loop re-enqueues due `PENDING` /
`RETRY` work and expired leases from PostgreSQL using a stable BullMQ job ID.
Lease-token conditional completion prevents a stale worker from completing a
newer claim. An internal, audited manual retry method is reserved for future
operations UI/API. Outbound delivery, channel CRUD, and frontend remain outside
this slice.

### Scope

- InboxRecord, OutboxRecord, IdempotencyRecord, RawWebhookEvent,
  RejectedWebhookAttempt;
- relay/recovery scan и BullMQ signals;
- lease expiry и crash recovery;
- retry classification, unknown и reconciliation foundation;
- Telegram connection validation и webhook registration через outbox;
- webhook secret verification до raw persist;
- body limit 2 MB;
- raw valid event retention metadata;
- Telegram parser для pilot text/command/callback и provider media metadata;
- NormalizedEvent, Message, OrphanMessageStatus;
- lazy media metadata и validation hooks;
- logs/correlation/manual retry foundation.

### Key tests

```text
valid webhook → inbox commit → fast acknowledgement
invalid signature → no raw body/inbox
duplicate update_id → prior acknowledgement, one domain effect
DB commit + missing BullMQ job → relay restores execution
worker crash after claim → lease recovery
provider timeout after possible effect → outbox unknown, no blind retry
status before message → OrphanMessageStatus → later attachment
paused project → deferred inbox → resume processing
```

### Exit criteria

- Реальный или mock Telegram webhook создаёт один normalized event/contact/message.
- Потеря Redis job не теряет PostgreSQL intent.
- Никакой CRM или automation side effect ещё не требуется.

## Этап 4. Минимальный Automation Runtime

### Scope

- Scenario/ScenarioVersion;
- immutable publish и draft;
- compiled deterministic definition;
- ScenarioExecution/NodeExecution;
- Incoming Message trigger;
- Condition с branch priority, strict null/type semantics;
- Add/Remove Tag;
- Send Message через outbox;
- Create/Update Lead и Forward to CRM через `CrmClient` port;
- execution log;
- minimal graph editor/forms только для pilot nodes;
- conversation serialization;
- graph validation, включая ports и unguarded cycles.

### Отложено

- Delay, Wait, Subflow;
- arbitrary iteration loops;
- External HTTP Request;
- advanced test debugger;
- cross-channel nodes.

### Key tests

- один trigger создаёт не более одного execution на idempotency policy;
- все matching scenarios запускаются;
- порядок между scenarios не предполагается;
- события одной conversation исполняются последовательно;
- branch выбирается по priority;
- null не coerced;
- published graph не изменяется draft autosave;
- node side effect переживает worker restart без слепого дублирования.

### Exit criteria

- Pilot graph создаётся, валидируется, публикуется и исполняется из Telegram event.
- Execution path и safe node inputs/outputs видны в журнале.

## Этап 5. CRM Adapter и полный Telegram ↔ CRM pilot

### Entry gate

Для production adapter выполнены exit criteria
`docs/CRM_CONTRACT_REQUIRED.md`. Если CRM contract ещё отсутствует, этап
выполняется только с mock adapter и не маркируется production-ready.

### Scope

- environment-only `CRM_BASE_URL`/`CRM_AUTH_TOKEN`;
- CrmProjectConfig;
- CrmClient interface;
- deterministic mock adapter;
- production adapter только после contract review;
- create/update lead и forward message через outbox;
- inbound CRM callback inbox/security после подтверждения контракта;
- reconciliation и manual retry;
- полный execution correlation;
- Telegram outbound response.

### Current mock implementation

The pilot mock includes a per-project configuration, deterministic `CrmClient`
adapter, CRM-specific outbox records, safe retry classification and a project
operation journal. Terminal `FAILED` records can be requeued; `UNKNOWN` requires
explicit operator confirmation because the external side effect may already have
occurred. This is not a production CRM integration and remains gated by
`docs/CRM_CONTRACT_REQUIRED.md`.

### Cyber Pulse production adapter (2026-07-29)

The authoritative Cyber Pulse staging contract is now available. The worker
uses the real authenticated HTTP `CrmClient`, PostgreSQL CRM outbox, safe
retry/unknown classification and reconciliation by idempotency key. The API
also exposes the independently authenticated CRM-to-Omnicus Telegram queue and
delivery reconciliation contract. See `docs/CRM_INTEGRATION.md`.

Live staging E2E and Railway credential installation remain external acceptance
gates; the legacy CRM cleanup must not run before those checks pass.

### Key tests

- CRM mock success;
- retryable/permanent/unknown outcomes;
- duplicate CRM operation idempotency key;
- project mapping не доверяет caller-provided internal projectId;
- CRM outage не блокирует webhook acknowledgement;
- callback duplicate не создаёт повторный Telegram message;
- response отправляется через outbox.

### Exit criteria pilot

- Telegram → Omnicus → CRM mock → Omnicus → Telegram работает end-to-end.
- Failure/retry/unknown видны оператору.
- Backup restore procedure выполнена и задокументирована.
- Railway staging deployment соответствует RPO 24h/RTO 4h baseline.
- Проведён pilot review и принято решение о следующих функциях.

### External validation gates

The mock pipeline is the only CRM path that can be completed without outside
access. `docs/PILOT_EXTERNAL_GATES.md` lists the exact CRM contract, Telegram
test bot, Railway staging and backup-restore inputs required before a real
provider/deployment acceptance run. WhatsApp and Instagram remain explicitly
outside this pilot.

## После pilot

Последовательность определяется отдельным review. Исходный backlog:

1. Production CRM adapter, если pilot был mock-only.
2. Wait/Delay и advanced automation semantics.
3. WhatsApp adapter и template policy.
4. Broadcasts и consent workflows.
5. External HTTP Request node.
6. Subflows.
7. Расширенный media pipeline.
8. Instagram только после отдельного подтверждения.

Каждый пункт требует отдельного scope, threat review, NFR и acceptance criteria.

## Automation v2 — approved post-pilot slice

This slice is limited to the existing Telegram channel and adds a React Flow
canvas, draft autosave/history, durable Delay, Wait for Reply, and Subflow
continuations. The worker recovers due delays and wait timeouts from PostgreSQL;
it never relies on a process-local timer. The slice does not add External HTTP,
WhatsApp/Instagram, broadcasts, templates or media workflows.

Acceptance requires deterministic graph validation, a published-version pin for
subflows, one active wait per conversation/scenario, transactional reply versus
timeout resolution, worker-crash recovery, execution journal visibility, and
protected project-scoped UI/API operations.

Implementation includes deterministic graph validation, a React Flow draft editor,
published-version execution, durable Delay/Wait continuations and pinned
Subflows. External HTTP, broadcasts, templates, extra channels and advanced
media remain outside this slice.

## Contacts v2 — approved post-pilot slice

Contacts v2 adds saved segments, typed custom-field projections and an explicit,
manual contact merge. It keeps the existing Telegram identity model and does
not introduce broadcasts, import/export, another channel or media workflows.
The primary contact is selected by an operator; merge never starts from a fuzzy
match. Segment membership is calculated at query time from project-scoped
filters and is not stored as a mutable recipient list.

## Telegram Broadcasts — approved post-pilot slice

Telegram Broadcasts add project-scoped drafts, scheduled or immediate launch,
an audience snapshot, recipient technical status and pause/resume/cancel
controls. The snapshot creates one transactional `Message` plus `OutboxRecord`
per eligible Telegram identity, with a stable broadcast-recipient idempotency
key. Existing Telegram outbound retry, 429 handling and `UNKNOWN` delivery
semantics remain authoritative; a broadcast never calls Telegram directly.

This slice is Telegram text only. It excludes templates, WhatsApp, Instagram,
advanced media, analytics funnels and consent workflows beyond the current
blocked/unsubscribed eligibility guard.

## Telegram media, templates and visual automation completion

This post-broadcast slice adds lazy Telegram photo/document materialization,
private object storage, signed access, application retention jobs and media
delivery through the existing transactional outbox. It also adds project-scoped
text/photo/document templates with immutable published versions and pins those
versions from scenarios and broadcasts.

The existing React Flow editor is completed with typed node forms, port-aware
connections, validation feedback, template selection, version history and a
node-by-node execution inspector. This slice remains Telegram-only and does not
introduce CRM provider endpoints, WhatsApp, Instagram or deployment.

Implementation additionally preserves branch output/priority/conditions during
canvas round-trips, pins both template and subflow versions, renders broadcast
templates per recipient, and rejects save/publish while deterministic graph
validation has errors. Media remains a provider reference until requested;
validated materialization, signed delivery and retention all use PostgreSQL
lifecycle state rather than an in-memory assumption.

## Pilot NFR

| Requirement                  | Initial target                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Webhook acknowledgement      | После signature/size validation и durable inbox commit; без ожидания CRM/runtime/outbound |
| Raw webhook body             | Максимум 2 MB                                                                             |
| Future External API response | Максимум 5 MB                                                                             |
| Broadcast size               | Неприменимо для pilot                                                                     |
| Technical logs retention     | 30 дней                                                                                   |
| Audit retention              | 180 дней                                                                                  |
| Valid raw payload retention  | 30 дней                                                                                   |
| RPO                          | 24 часа                                                                                   |
| RTO                          | 4 часа                                                                                    |
| Restore verification         | Обязательная документированная проверка                                                   |

До production необходимо дополнить нагрузочные цели наблюдениями pilot:
ожидаемые connections/projects, webhook rate, queue latency и объём хранения.

## Внешние blockers

- Production CRM contract/OpenAPI.
- Реальные Telegram credentials для live acceptance.
- Railway staging project и environment access.
- Решение владельца данных по необходимости application-side media encryption.

## Stage 3C.1 — Telegram channel backend and transactional outbound

Implemented backend-only channel management for Telegram: project-scoped channel
permissions, encrypted token/secret handling, `getMe` validation, webhook
connect/disable/secret rotation, and a test-message endpoint. The outbound path
creates `Message` and `OutboxRecord` transactionally, then enqueues only the
outbox ID. The worker claims records with a lease, records retryable failures as
`RETRY`, preserves uncertain timeout outcomes as `UNKNOWN`, and periodically
re-enqueues pending/retry and stale-lease records. Frontend channel screens and
all non-Telegram providers remain outside this sub-stage.
