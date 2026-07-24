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
