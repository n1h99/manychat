# OMNICUS — implementation plan

## Статус

План подготовлен для первого pilot. Scaffold Этапа 0 реализован; Этап 1 не
начат. Prisma migrations, deploy и бизнес-код не выполнялись.

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
