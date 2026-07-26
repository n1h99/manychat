# OMNICUS — Architecture Decision Records

Статус документа: обязательные решения для pilot.  
Дата фиксации: 2026-07-24.

Принятые решения изменяются только новым ADR, который заменяет предыдущий и
описывает миграционные последствия.

## ADR-001. At-least-once, transactional inbox/outbox

**Статус:** Accepted.

**Контекст:** webhook, queue worker и внешняя система не образуют общую
транзакцию. Падение возможно между database commit, enqueue, внешним вызовом и
сохранением ответа.

**Решение:**

- обещается at-least-once processing;
- end-to-end exactly-once не обещается;
- входящие события фиксируются в PostgreSQL `InboxRecord`;
- внешние операции фиксируются в PostgreSQL `OutboxRecord`;
- доменное изменение и создание inbox/outbox записи выполняются в одной
  PostgreSQL transaction;
- relay/recovery process публикует jobs в BullMQ;
- Redis/BullMQ не является источником истины;
- каждый side effect имеет idempotency key;
- состояния side effect:
  `pending → processing → succeeded | failed | unknown`;
- `unknown` обрабатывается reconciliation или ручным retry;
- ручной retry всегда создаёт audit record.

**Последствия:** потребуется outbox relay, lease/lock, recovery scan, retry
classification и reconciliation API/UI. Дубликаты исполнения допустимы, дубликаты
доменного результата предотвращаются idempotency records и provider keys.

## ADR-002. Глобальная CRM-конфигурация и отложенный реальный adapter

**Статус:** Accepted.

**Контекст:** реальный CRM API/OpenAPI не предоставлен.

**Решение:**

- CRM одна для всех проектов;
- `CRM_BASE_URL` и `CRM_AUTH_TOKEN` находятся только в environment variables;
- PostgreSQL хранит `CrmProjectConfig`: `crmProjectId`, field mapping,
  pipeline/stage и дополнительные project-specific параметры;
- до получения контракта создаются только `CrmClient` interface, mock adapter и
  fixtures;
- реальные endpoint, payload, error mapping и rate limits не предполагаются;
- реализация production CRM adapter блокируется требованиями из
  `docs/CRM_CONTRACT_REQUIRED.md`.

**Последствия:** pilot проверяет полный pipeline на mock CRM. Production CRM
интеграция не считается завершённой до contract review.

## ADR-003. JWT access token и opaque rotating refresh token

**Статус:** Accepted.

**Контекст:** refresh JWT усложняет немедленный отзыв и reuse detection.

**Решение:**

- access token — короткоживущий JWT;
- refresh token — криптографически случайный opaque token;
- БД хранит только hash refresh token;
- refresh tokens объединены в family;
- rotation инвалидирует использованный token и выпускает новый;
- повторное использование старого token отзывает всю family и создаёт security
  audit event;
- refresh cookie: `HttpOnly`, `Secure`, explicit `SameSite`, ограниченные
  `Path` и lifetime;
- cookie-based state-changing auth operations требуют Origin/Referer validation
  и synchronizer CSRF token в отдельном header;
- `JWT_REFRESH_SECRET` не используется.

**Последствия:** нужны `Session`/token-family fields и `csrfTokenHash`.

## ADR-004. Наследование automation mode

**Статус:** Accepted.

**Решение:** effective mode вычисляется:

```text
Conversation.automationModeOverride
→ Contact.automationMode
→ automation_enabled
```

Conversation хранит nullable override, а не второе обязательное значение.
Изменение contact mode не перезаписывает conversation override.

**Последствия:** API и UI должны показывать effective mode и источник значения.

## ADR-005. Невалидные webhook

**Статус:** Accepted.

**Решение:**

- signature/secret проверяется до сохранения raw body;
- при невалидной подписи payload и секретные headers не сохраняются;
- сохраняется `RejectedWebhookAttempt` либо security log со следующими safe
  metadata: provider, connectionId, timestamp, source IP, allowlisted/redacted
  headers, rejection reason и correlation ID;
- запрос отклоняется без enqueue;
- body size limit применяется до parsing и равен 2 MB.

**Последствия:** invalid attempts пригодны для security monitoring, но не для
повторной обработки.

## ADR-006. Детерминированная семантика automation engine

**Статус:** Accepted.

**Решение:**

- условные branches проверяются по сохранённому integer priority;
- output port имеет максимум одно active edge, кроме schema-marked branching
  nodes;
- `null` не преобразуется в string/number автоматически;
- coercion разрешается только явной node configuration;
- на пару `(conversationId, scenarioId)` допускается один active Wait for Reply;
- inbound event сначала транзакционно пытается разрешить active Wait, затем может
  запускать остальные scenarios;
- reply и timeout соревнуются через conditional update/row lock; выигрывает один;
- subflow pin-ится на конкретный published `ScenarioVersion`;
- по умолчанию все matching scenarios запускаются, порядок между ними не
  гарантируется;
- события одной conversation сериализуются PostgreSQL sequence/lock policy;
- unguarded cycle — цикл без Delay, Wait или явного iteration limit; publish
  запрещён.

**Последствия:** даже если Wait/Subflow не входят в pilot, validator и data model
должны сохранять совместимую семантику.

## ADR-007. Обязательные модели и tenant integrity

**Статус:** Accepted.

**Решение:** модель включает `CustomFieldDefinition`, `Segment`, `MediaAsset`,
`CrmProjectConfig`, `InboxRecord`, `OutboxRecord`, `IdempotencyRecord`,
`PasswordResetToken`, `UserInviteToken`, `GlobalUserRole`, `ChannelConsent` и
`OrphanMessageStatus`.

Все tenant-owned таблицы имеют `projectId`. Tenant-safe relation обеспечивается
composite unique keys `(projectId, id)` и composite foreign keys, а также project
access guards.

**Последствия:** простого наличия `projectId` недостаточно; cross-project link
должен физически отклоняться БД.

## ADR-008. Media lifecycle pilot

**Статус:** Accepted.

**Решение:**

- inbound provider media сначала хранится как metadata/provider media ID;
- download выполняется только по необходимости;
- перед сохранением проверяются MIME, размер и расширение;
- assets шаблонов хранятся в private Railway Bucket;
- доступ выдаётся signed URL с коротким TTL;
- retention и delete выполняются application jobs;
- bucket не считается private network;
- server-side encryption, versioning и lifecycle policies Railway Bucket не
  обещаются.

**Последствия:** расширенная media processing pipeline отложена; чувствительность
данных определяет необходимость application-side encryption отдельным ADR.

## ADR-009. Формальные state machines

**Статус:** Accepted.

**Решение:** состояния и transitions для Project, ChannelConnection, Scenario,
ScenarioExecution, Message, Broadcast, BroadcastRecipient, InboxRecord и
OutboxRecord определяются в `docs/STATE_MACHINES.md`. Каждый transition содержит
from, event, guard, to, side effects и retry policy.

**Последствия:** service methods должны реализовывать events, а не произвольную
запись status.

## ADR-010. Scope первого pilot

**Статус:** Accepted.

**Решение:** pilot включает Auth/RBAC, projects, contacts/tags/custom field
definitions, Telegram, CRM mock, минимальный runtime, execution log,
transactional inbox/outbox и Railway deployment.

Не входят WhatsApp, Instagram, broadcasts, Delay, Wait, Subflows, полноценный
External HTTP Request editor и расширенные media workflows.

**Последствия:** общая архитектура сохраняет extension points, но UI/API и
acceptance pilot не должны требовать отложенные функции.

## ADR-011. Этапы реализации

**Статус:** Accepted.

**Решение:**

1. scaffold и ADR;
2. Auth/RBAC/Projects;
3. Contacts/Tags/Custom Fields;
4. Inbox/Outbox и Telegram adapter;
5. минимальный automation runtime;
6. CRM adapter и Telegram ↔ CRM pilot;
7. последующие функции только после pilot review.

Нумерация в implementation plan начинается с Этапа 0.

**Последствия:** hardening-инварианты не откладываются; безопасность,
идемпотентность и observability baseline входят в соответствующие ранние этапы.

## ADR-012. NFR baseline pilot

**Статус:** Accepted.

**Решение:**

- валидный webhook подтверждается без ожидания CRM;
- raw webhook body ≤ 2 MB;
- будущий External API response ≤ 5 MB;
- broadcast size для pilot неприменим;
- technical logs retention — 30 дней;
- audit retention — 180 дней;
- valid raw webhook payload retention — 30 дней;
- RPO — 24 часа;
- RTO — 4 часа;
- backup restore test обязателен и документируется.

**Последствия:** это стартовые значения, которые пересматриваются после
наблюдений pilot новым ADR.

## ADR-013. Stage 0 toolchain и workspace

**Статус:** Accepted.

**Решение:** использовать точно Node.js 24.18.0, pnpm 10.5.0 и Turborepo. Node
pin одновременно хранится в `.node-version`, `engines.node`, CI и generated
runtime manifests; preflight сравнивает полную фактическую версию с
`.node-version`. Приложения
размещаются в `apps/web`, `apps/api`, `apps/worker`; инфраструктурные библиотеки —
в `packages/database`, `packages/shared`, `packages/contracts`,
`packages/config`, `packages/channel-core`, `packages/test-fixtures`. Версии
runtime и package manager фиксируются в корневом `package.json`.

**Последствия:** Telegram, CRM и automation packages не создаются на Этапе 0;
чистая установка должна воспроизводиться из `pnpm-lock.yaml`.

## ADR-014. Prisma ownership и initial migration gate

**Статус:** Accepted.

**Решение:** Prisma schema, configuration, generated client и будущие migrations
принадлежат `packages/database`. Этап 0 создаёт и валидирует schema, но не создаёт
initial migration. Migration допускается только после отдельного отчёта с review
generated SQL. Seed разрешён только для development/test и не создаёт production
данные.

**Последствия:** health probe может проверить соединение `SELECT 1`, но доменные
таблицы не существуют до одобренной migration.

## ADR-015. Stage 0 structured logging

**Статус:** Accepted.

**Решение:** API и worker используют встроенный NestJS `ConsoleLogger` в JSON
режиме и propagation безопасного correlation ID. Дополнительная logging library
не устанавливается до появления измеримой потребности в transport/redaction,
которую встроенный logger не покрывает.

**Последствия:** логи пригодны для Railway ingestion без дополнительной
зависимости; правила PII redaction должны быть расширены вместе с бизнес-полями.

## ADR-016. Stage 0 BullMQ и outbox relay checkpoint

**Статус:** Accepted.

**Решение:** BullMQ на Этапе 0 содержит только disposable
`system-health/demo-job` для проверки consumer lifecycle. Стратегия outbox relay
не реализуется и выбирается перед Этапом 3 вместе с transactional inbox/outbox;
PostgreSQL остаётся источником истины.

**Последствия:** demo job не является durable domain command и не создаёт
архитектурного обещания о polling, notifications или delivery ordering.

## ADR-017. Railway topology и будущий cookie boundary

**Статус:** Accepted.

**Решение:** web, API и worker развёртываются как три Railway services из одного
monorepo с отдельными build/start commands и healthchecks. На Этапе 0 CORS
разрешает явный список web origins. Cookie domain, SameSite и CSRF topology
фиксируются до Auth на Этапе 1.

**Последствия:** Stage 0 не создаёт cookies и auth endpoints; production origins
не выводятся автоматически и задаются environment variables.

## ADR-018. Stage-sliced baseline и физические RBAC boundaries

**Статус:** Accepted.

**Контекст:** первоначальный full-domain Prisma proposal создавал около сорока
таблиц в первой migration. Nullable `Role.projectId` и composite references
позволяли `RolePermission` без фактического parent role, а project invite мог
потерять role boundary.

**Решение:** executable Prisma schema до Этапа 1 содержит только
Auth/RBAC/Projects и audit infrastructure. Последующие домены добавляются
отдельными migrations на своих этапах. Global и project roles, permissions,
assignments и invites представлены разными таблицами. Project relations всегда
включают обязательный `projectId`; project invite → role использует
`ON DELETE RESTRICT`. `AuditLog.project` также использует `RESTRICT` и хранит
immutable project snapshots.

**Последствия:** nullable RBAC scope и orphan assignments невозможны по
структуре. Первая migration остаётся небольшой и reviewable. Полный design
proposal в `docs/DATABASE.md` не является executable schema. Любое изменение
slice требует нового SQL diff review; migration Этапа 0 по-прежнему не
создаётся.

## ADR-019. Минимальный production web server

**Статус:** Accepted.

**Контекст:** исходный Stage 0 static server выполнял `decodeURIComponent`
вне error boundary и не обрабатывал stream errors, поэтому malformed URL либо
ошибка чтения могли завершить process.

**Решение:** сохранить минимальный Node.js HTTP server без новой runtime
зависимости. Весь request pipeline обёрнут единым error boundary; malformed
percent encoding возвращает `400`, отсутствующий asset — `404`, extensionless
route — SPA fallback. File-open/stream errors логируются и изолируются. Server
добавляет baseline security headers и отдельные live/ready endpoints.

**Последствия:** production behavior покрывается regression tests против
собранного Vite artifact. Готовый static-server package не добавляется: текущий
surface мал, а новая dependency не уменьшила бы review scope.

## ADR-020. Stage 0 dependency advisory policy

**Статус:** Accepted.

**Контекст:** audit от 24 июля 2026 обнаружил high advisories
`GHSA-c96f-x56v-gq3h` (`find-my-way <= 9.6.0`),
`GHSA-pm4m-ph32-ghv5` (`js-yaml <= 5.2.1`) и
`GHSA-qwww-vcr4-c8h2` (`react-router >= 7.12.0 < 8.3.0`). Повторная проверка
также выявила moderate `GHSA-5qjj-4xww-7phc` (`valibot <= 1.4.1`).

**Решение:** production audit блокирует high/critical. Для transitive packages
используются узкие pnpm overrides на официально исправленные
`find-my-way 9.7.0`, `js-yaml 5.2.2` и `valibot 1.4.2`; overrides проверяются
полным набором tests/build. React Router обновляется напрямую до `8.3.0`,
потому что patched 7.x не существует. `react-router-dom` удалён согласно
официальному v8 upgrade guide; declarative imports перенесены в `react-router`.

**Последствия:** major Router upgrade принят только как security remediation.
Минимальные v8 requirements выполняются Node 24.18.0, React 19.2.8 и Vite 8.1.
Новые исключения допускаются только по процессу
`docs/DEPENDENCY_EXCEPTIONS.md`; текущих исключений нет.

## ADR-021. Runtime configuration и artifacts разделены по trust boundary

**Статус:** Accepted.

**Контекст:** общий config entry point позволял browser build разрешать
server-only validation code. Загрузка `.env`, зависящая от CWD, и development
fallbacks также делали поведение clean clone, Railway и Prisma CLI
неоднозначным. Полная workspace installation не нужна в runtime artifacts API
и worker.

**Решение:**

- экспортировать browser и server configuration только через
  `@omnicus/config/web` и `@omnicus/config/server`;
- находить корневой `.env` относительно module location, а не CWD; не искать
  CWD fallback в standalone artifact и игнорировать `.env`, когда
  staging/production `APP_ENV` уже задан process environment;
- требовать явные staging/production values и проверять protocol/origin
  allowlists до bootstrap;
- собирать `.runtime` artifacts, в которых API/worker содержат только production
  dependencies, удалять недостижимые entries из pnpm isolated virtual store и
  stale generated/build output, а web source maps отключать;
- позволить Railpack выполнить lockfile installation один раз; service build
  commands выполняют preflight и filtered build без повторного install.

**Последствия:** production build/process рано завершается при отсутствующей или
опасной конфигурации. Web output сканируется на server variable/schema markers.
Prisma validate может использовать явный non-connecting placeholder, но
migration/seed не могут его унаследовать. Текущий размер Stage 0 web chunk принят
без route splitting; lazy route boundaries пересматриваются при добавлении
первых business modules.

## ADR-022. Active invitation reservation вместо partial unique Prisma selector

**Статус:** Accepted.

**Контекст:** partial `@@unique` для active invitations создавал PostgreSQL
partial unique index, но Prisma Client одновременно генерировал обычный
compound `WhereUniqueInput`. После появления historical accepted/revoked rows
`findUnique`, `update` или `delete` по такому selector могли не включать
predicate active-state и обращаться к нескольким history rows.

**Решение:** хранить invitation history отдельно от active reservation.
`GlobalActiveInviteReservation` использует primary key
`(normalizedEmail, globalRoleId)`; `ProjectActiveInviteReservation` использует
`(projectId, normalizedEmail)`. В обеих моделях `inviteTokenId` уникален и
связан composite FK с historical invitation в том же scope. Future invitation
service создаёт token и reservation в одной transaction; любой terminal
transition обновляет token и удаляет reservation в той же transaction.

**Последствия:** historical invitation могут сосуществовать, но ровно одна
active reservation существует для заданного scope. Prisma preview feature
`partialIndexes` больше не нужна в Stage 1 baseline. Baseline увеличивается с
14 до 16 tables, но остаётся stage-sliced; migration по-прежнему не создана.

## ADR-023. Создание пользователей Stage 1 через временный пароль

**Статус:** Accepted.

**Решение:** до подключения проверенного mail provider `POST /api/v1/users`
требует временный пароль, переданный уполномоченным администратором по
защищённому каналу. Пароль сохраняется только как Argon2id hash и никогда не
возвращается API, в audit или логах. Invite history/reservation модели остаются
зарезервированными для отдельного email-delivery этапа и не используются для
псевдо-email интеграции.

Project roles физически tenant-owned, поэтому нет глобальных role templates в
Stage 1 schema. Project creation transaction создаёт idempotentные system roles
для нового `projectId`; development seed делает то же для уже существующих
проектов. Это сохраняет composite project foreign keys и исключает cross-project
assignment.

**Последствия:** первый administrator и новые users могут входить сразу с
временным паролем; принудительная смена пароля, reset flow и email invitation не
реализуются в Этапе 1.

## ADR-024. Stage 2 custom-field values and archival

**Статус:** Accepted.

**Решение:** Stage 2 stores a contact's custom-field values in `Contact.customFields`
as JSON. Every write is checked against the project-local
`CustomFieldDefinition`; values not matching the declared type, or select values
outside its options, are rejected. This avoids a premature sixth value/indexing
model while channels and segmentation are absent. A deleted definition is
archived (`archivedAt`), never hard-deleted; existing contact JSON is retained
as history and is no longer editable through the API.

**Последствия:** No automatic contact merge or value deletion exists in this
slice. A later indexed-value/segment migration must explicitly backfill and
retain the same validation semantics before it can replace this representation.

## ADR-025. Channel secret encryption envelope

**Статус:** Accepted.

**Решение:** Channel credentials use `CHANNEL_SECRETS_KEY`, an explicit 32-byte
Base64 key, with Node.js AES-256-GCM. `ChannelSecretsService` stores only a
versioned JSON envelope and binds encryption with AAD
`projectId:connectionId:channelType:field`. Tokens and webhook secrets never
appear in reads, logs, validation payloads or audit JSON. Pilot key version is
one; later key rotation may add a previous decrypt key and a re-encryption job.

**Последствия:** API and worker require the same key in every environment,
including an explicit distinct test key. A crypto failure changes the connection
to error and records only a safe audit/security event.
