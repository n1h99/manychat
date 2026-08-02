# OMNICUS — формальные state machines

Status reviewed: 2026-08-02. The generic outbox machine applies to Telegram,
CRM and Automation Studio 2.2 HTTP operations.

## Общие правила

- Status изменяется только через перечисленные events.
- Guard проверяется в той же PostgreSQL transaction, что и status update.
- Side effect сначала создаёт `OutboxRecord`; внешний вызов не выполняется внутри
  доменной transaction.
- `none` в retry policy означает, что повтор event не нужен или запрещён.
- `automatic` означает bounded exponential backoff с jitter.
- `manual` требует permission, reason и audit.
- Для optimistic concurrency используется `version` либо conditional update
  `WHERE status = <expected>`.
- Каждый transition записывает technical event; пользовательские и security
  действия дополнительно записываются в audit согласно таблицам ниже.

## Project

Состояния: `draft`, `active`, `paused`, `archived`.

| From     | Event                     | Guard                                    | To         | Side effects                                                                                          | Retry policy                       |
| -------- | ------------------------- | ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| —        | `project.create`          | Уникальный slug, actor имеет permission  | `draft`    | Создать project и membership администратора; audit                                                    | Idempotency-Key, replay результата |
| `draft`  | `project.activate`        | Обязательные настройки валидны           | `active`   | Разрешить обработку новых inbox records; audit                                                        | none                               |
| `active` | `project.pause`           | Actor имеет permission                   | `paused`   | Остановить запуск новых scenarios и новых outbound side effects; уже `processing` не прерывать; audit | none                               |
| `paused` | `project.resume`          | Настройки валидны                        | `active`   | Перевести project inbox `deferred` в `received`, запустить relay; audit                               | Relay automatic                    |
| `draft`  | `project.archive`         | Нет активных channel/outbox операций     | `archived` | Отключить draft connections; audit                                                                    | none                               |
| `paused` | `project.archive`         | Channels disabled, нет processing outbox | `archived` | Закрыть deferred inbox как `ignored`; audit                                                           | none                               |
| `active` | `project.archive.request` | Всегда                                   | `paused`   | Начать controlled drain; audit                                                                        | none                               |

Валидный webhook для `paused` project подтверждается быстро и сохраняется как
`InboxRecord.deferred`. Он не запускает scenario/CRM/outbound до resume. Для
`archived` project stale webhook подтверждается после проверки подписи, но
фиксируется как `ignored` без бизнес-обработки, чтобы provider не создавал retry
storm.

## ChannelConnection

Состояния: `draft`, `connecting`, `connected`, `error`, `disabled`.

| From         | Event                            | Guard                                               | To           | Side effects                                                                                                         | Retry policy             |
| ------------ | -------------------------------- | --------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| —            | `channel.create`                 | Project существует, type поддержан                  | `draft`      | Сохранить metadata и encrypted credentials; audit                                                                    | Idempotency-Key          |
| `draft`      | `channel.connect`                | Credentials присутствуют, project не archived       | `connecting` | Создать outbox `channel.validate_and_register`; audit                                                                | automatic                |
| `connecting` | `channel.registration.succeeded` | Outbox result соответствует connection/version      | `connected`  | Сохранить provider metadata/capabilities, webhook status                                                             | none                     |
| `connecting` | `channel.registration.failed`    | Permanent либо attempts exhausted                   | `error`      | Safe error, alert                                                                                                    | manual после исправления |
| `connecting` | `channel.registration.unknown`   | Outcome provider неизвестен                         | `error`      | Запланировать reconciliation (`getWebhookInfo` для Telegram)                                                         | automatic, затем manual  |
| `connected`  | `channel.provider_error`         | Ошибка влияет на доступность                        | `error`      | Остановить новые outbound, alert                                                                                     | automatic validation     |
| `error`      | `channel.reconnect`              | Credentials/config изменены либо retry разрешён     | `connecting` | Новый attempt group/outbox; audit                                                                                    | automatic                |
| `draft`      | `channel.disable`                | Всегда                                              | `disabled`   | Redact/revoke pending config where possible; audit                                                                   | none                     |
| `connected`  | `channel.disable`                | Нет processing outbox либо подтверждён drain policy | `disabled`   | Outbox unregister webhook; queued Message → `cancelled`, его Outbox → `failed` с permanent `CHANNEL_DISABLED`; audit | automatic/reconcile      |
| `error`      | `channel.disable`                | Всегда                                              | `disabled`   | Cancel pending retries; audit                                                                                        | none                     |
| `disabled`   | `channel.enable`                 | Credentials валидны, project active/draft           | `connecting` | Validate/register outbox; audit                                                                                      | automatic                |
| `connected`  | `channel.rotate_secret`          | Actor имеет rotate permission                       | `connecting` | Версионировать secret; register new webhook; старый secret действует ограниченное overlap window; audit              | automatic/reconcile      |

## Scenario

Состояния aggregate: `draft`, `published`, `paused`, `archived`. Published
`ScenarioVersion` immutable.

| From        | Event                    | Guard                                                             | To          | Side effects                                                             | Retry policy                           |
| ----------- | ------------------------ | ----------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ | -------------------------------------- |
| —           | `scenario.create`        | Permission, уникальное имя не обязательно                         | `draft`     | Создать draft version; audit                                             | Idempotency-Key                        |
| `draft`     | `scenario.publish`       | Graph valid; нет unguarded cycle; ports/capabilities/config valid | `published` | Immutable published version, compiled definition, activeVersionId; audit | none                                   |
| `published` | `scenario.edit`          | Permission                                                        | `published` | Создать/обновить отдельную draft version; activeVersion не менять        | Explicit Save с optimistic concurrency |
| `published` | `scenario.publish_draft` | Draft valid и base revision не устарела                           | `published` | Новая immutable version становится active; старая superseded; audit      | none                                   |
| `published` | `scenario.pause`         | Permission                                                        | `paused`    | Не создавать новые executions; активные продолжаются по policy; audit    | none                                   |
| `paused`    | `scenario.resume`        | Active version всё ещё valid                                      | `published` | Разрешить matching; audit                                                | none                                   |
| `published` | `scenario.rollback`      | Target version published и compatible                             | `published` | Target становится active без изменения immutable graph; audit            | none                                   |
| `draft`     | `scenario.archive`       | Нет published version                                             | `archived`  | Закрыть draft; audit                                                     | none                                   |
| `paused`    | `scenario.archive`       | Нет running/waiting executions либо выбрана cancel policy         | `archived`  | Cancel по policy; audit                                                  | Cancellation recovery                  |

Matching нескольких scenarios создаёт executions для всех совпадений. Порядок
между scenarios не гарантируется.

## ScenarioExecution

Состояния: `queued`, `running`, `waiting`, `paused`, `completed`, `failed`,
`cancelled`.

| From      | Event                      | Guard                                            | To          | Side effects                                                     | Retry policy             |
| --------- | -------------------------- | ------------------------------------------------ | ----------- | ---------------------------------------------------------------- | ------------------------ |
| —         | `execution.enqueue`        | Unique trigger policy/idempotency key            | `queued`    | Создать execution и BullMQ signal через outbox                   | Relay automatic          |
| `queued`  | `execution.start`          | Lease получен; project/scenario active           | `running`   | Зафиксировать worker/lease/start                                 | Lease recovery           |
| `queued`  | `execution.defer`          | Project paused                                   | `paused`    | Не исполнять nodes                                               | Resume event             |
| `running` | `node.complete`            | Node execution committed; есть next edge         | `running`   | Обновить cursor/variables, enqueue continuation                  | automatic                |
| `running` | `execution.wait`           | Node поддерживает wait; unique active wait guard | `waiting`   | Создать WaitState и timeout job                                  | Relay automatic          |
| `waiting` | `wait.reply`               | Conditional claim выигрывает                     | `queued`    | Resolve WaitState, save event variable, cancel timeout logically | Relay automatic          |
| `waiting` | `wait.timeout`             | Conditional claim выигрывает                     | `queued`    | Resolve timeout edge                                             | Relay automatic          |
| `running` | `execution.complete`       | Нет следующего node                              | `completed` | Final log/metrics                                                | none                     |
| `running` | `node.retryable_failure`   | Attempts остаются                                | `queued`    | Сохранить error, schedule retry                                  | automatic                |
| `running` | `node.permanent_failure`   | Нет failure edge либо failure edge завершилась   | `failed`    | Error log/alert according severity                               | manual only if node safe |
| `queued`  | `execution.cancel`         | Permission/system cancellation                   | `cancelled` | Cancel pending continuations; audit for manual                   | none                     |
| `running` | `execution.cancel.request` | Всегда                                           | `running`   | Set cancellationRequested; worker stops at safe boundary         | Worker recovery          |
| `paused`  | `execution.resume`         | Project/scenario permits                         | `queued`    | Enqueue continuation                                             | Relay automatic          |

События одной conversation получают монотонный `conversationSequence` и
обрабатываются последовательно. Lock не хранится только в памяти.

## Contact

Состояния: `active`, `blocked`, `unsubscribed`, `archived`, `merged`.

| From                                            | Event                 | Guard                                                        | To                   | Side effects                                                                                                       | Retry policy                                         |
| ----------------------------------------------- | --------------------- | ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `active`                                        | `contact.block`       | Permission и project boundary                                | `blocked`            | Сохранить status; audit                                                                                            | none                                                 |
| `active`                                        | `contact.unsubscribe` | Permission/system channel event                              | `unsubscribed`       | Остановить новые outbound по consent policy; audit                                                                 | none                                                 |
| `active`, `blocked`, `unsubscribed`             | `contact.archive`     | Permission                                                   | `archived`           | Set `archivedAt`; сохранить историю                                                                                | none                                                 |
| `active`, `blocked`, `unsubscribed`, `archived` | `contact.merge`       | Primary и secondary принадлежат project; secondary не merged | `merged` (secondary) | Transactionally re-parent dependent records, tags and non-conflicting identities; set `mergedIntoContactId`; audit | none; operator chooses a new merge only after review |

`merged` is terminal for direct updates. Contact merge is never inferred from a
name, email or username match.

## Message

Состояния: `received`, `pending`, `processing`, `submitted`, `sent`, `delivered`,
`read`, `failed`, `unknown`, `cancelled`.

| From         | Event                         | Guard                                                            | To           | Side effects                                        | Retry policy                    |
| ------------ | ----------------------------- | ---------------------------------------------------------------- | ------------ | --------------------------------------------------- | ------------------------------- |
| —            | `message.inbound.persist`     | Unique `(projectId, connectionId, externalMessageId, direction)` | `received`   | Сохранить message; resolve orphan statuses          | Inbox retry                     |
| —            | `message.outbound.request`    | Channel/consent/window/template guards                           | `pending`    | Создать Message и OutboxRecord в одной transaction  | Relay automatic                 |
| `pending`    | `message.delivery.start`      | Outbox lease, channel connected                                  | `processing` | Adapter call с idempotency key                      | Lease recovery                  |
| `processing` | `provider.accepted`           | Valid provider response                                          | `submitted`  | External ID, safe response, outbox succeeded        | none                            |
| `processing` | `provider.sent`               | Provider не различает accepted/sent                              | `sent`       | External ID, outbox succeeded                       | none                            |
| `processing` | `provider.retryable_error`    | Retry budget остаётся                                            | `failed`     | Mark outbox failed/retryable                        | automatic                       |
| `processing` | `provider.permanent_error`    | Permanent classification                                         | `failed`     | Outbox failed, safe error                           | manual только после исправления |
| `processing` | `provider.outcome_unknown`    | Timeout/disconnect после возможной отправки                      | `unknown`    | Outbox unknown, reconciliation                      | reconcile, затем manual         |
| `submitted`  | `status.sent`                 | Event newer or valid progression                                 | `sent`       | MessageStatusEvent                                  | none                            |
| `submitted`  | `status.delivered`            | Out-of-order allowed                                             | `delivered`  | Сохранить промежуточные факты при наличии           | none                            |
| `sent`       | `status.delivered`            | Valid provider status                                            | `delivered`  | MessageStatusEvent                                  | none                            |
| `delivered`  | `status.read`                 | Channel поддерживает read                                        | `read`       | MessageStatusEvent                                  | none                            |
| `pending`    | `message.cancel`              | Delivery ещё не началась                                         | `cancelled`  | Cancel outbox; audit if manual                      | none                            |
| `failed`     | `message.retry`               | Retryable либо manual permission; idempotency strategy defined   | `pending`    | Новый attempt group, тот же logical idempotency key | automatic/manual                |
| `unknown`    | `reconciliation.succeeded`    | Provider confirms delivery                                       | `sent`       | Save external ID/result; outbox succeeded           | none                            |
| `unknown`    | `reconciliation.not_applied`  | Provider confirms no side effect                                 | `pending`    | Retry allowed                                       | automatic/manual                |
| `unknown`    | `reconciliation.inconclusive` | Attempts exhausted                                               | `unknown`    | Alert/manual queue                                  | manual                          |

Status до Message сохраняется как `OrphanMessageStatus` и присоединяется
транзакционно при появлении Message. Status regression не изменяет итоговый
status, но raw status fact сохраняется.

## Broadcast

Broadcasts не входят в pilot; state machine фиксирует последующий контракт.

Состояния: `draft`, `scheduled`, `preparing`, `running`, `paused`, `completed`,
`cancelled`, `failed`.

| From        | Event                 | Guard                               | To          | Side effects                                                            | Retry policy        |
| ----------- | --------------------- | ----------------------------------- | ----------- | ----------------------------------------------------------------------- | ------------------- |
| —           | `broadcast.create`    | Permission                          | `draft`     | Draft record; audit                                                     | Idempotency-Key     |
| `draft`     | `broadcast.schedule`  | Audience/message valid; future time | `scheduled` | Pin template/content version and audience definition; audit             | Scheduler recovery  |
| `draft`     | `broadcast.launch`    | Validation passes                   | `preparing` | Snapshot recipients in chunks; audit                                    | automatic           |
| `scheduled` | `schedule.due`        | Still valid and not cancelled       | `preparing` | Snapshot recipients                                                     | automatic           |
| `preparing` | `recipients.ready`    | Snapshot complete                   | `running`   | Enqueue recipient outboxes with rate policy                             | automatic           |
| `preparing` | `preparation.failed`  | Attempts exhausted                  | `failed`    | Safe error/alert                                                        | manual              |
| `running`   | `broadcast.pause`     | Permission                          | `paused`    | Stop creating/claiming new recipient jobs; in-flight continues; audit   | none                |
| `paused`    | `broadcast.resume`    | Template/channel still valid        | `running`   | Resume pending recipients; audit                                        | automatic           |
| `running`   | `broadcast.cancel`    | Permission                          | `cancelled` | Pending/queued recipients → cancelled; in-flight result retained; audit | Recovery scan       |
| `paused`    | `broadcast.cancel`    | Permission                          | `cancelled` | Pending recipients → cancelled; audit                                   | Recovery scan       |
| `running`   | `recipients.terminal` | Все recipients terminal             | `completed` | Aggregate technical summary                                             | Reconciliation scan |

Audience snapshot фиксируется при переходе в `preparing`; последующее изменение
segment не меняет recipients.

## BroadcastRecipient

Состояния: `pending`, `queued`, `processing`, `sent`, `delivered`, `read`,
`failed`, `skipped`, `cancelled`, `unknown`.

| From         | Event                   | Guard                                                | To           | Side effects                         | Retry policy     |
| ------------ | ----------------------- | ---------------------------------------------------- | ------------ | ------------------------------------ | ---------------- |
| —            | `recipient.snapshot`    | Unique `(projectId, broadcastId, channelIdentityId)` | `pending`    | Сохранить eligibility snapshot       | Chunk retry      |
| `pending`    | `recipient.validate`    | Consent/channel/template valid                       | `queued`     | Создать Message/Outbox               | Relay automatic  |
| `pending`    | `recipient.ineligible`  | Blocked/unsubscribed/window/template guard           | `skipped`    | Safe reason                          | none             |
| `queued`     | `recipient.start`       | Broadcast running, lease obtained                    | `processing` | Provider call through Message outbox | Lease recovery   |
| `processing` | `message.sent`          | Message terminal success                             | `sent`       | Link message                         | none             |
| `processing` | `message.unknown`       | Outcome unknown                                      | `unknown`    | Reconciliation                       | automatic/manual |
| `processing` | `message.failed`        | Attempts exhausted/permanent                         | `failed`     | Safe error                           | manual retry     |
| `sent`       | `status.delivered`      | Provider supports status                             | `delivered`  | Metrics                              | none             |
| `delivered`  | `status.read`           | Provider supports status                             | `read`       | Metrics                              | none             |
| `pending`    | `broadcast.cancelled`   | Not started                                          | `cancelled`  | No provider call                     | none             |
| `queued`     | `broadcast.cancelled`   | Lease not claimed                                    | `cancelled`  | Cancel outbox before processing      | Recovery scan    |
| `failed`     | `recipient.retry`       | Broadcast not cancelled; permission; retry safe      | `queued`     | New attempt group                    | automatic/manual |
| `unknown`    | `reconciliation.result` | See Message state machine                            | Result state | Sync from Message                    | same as Message  |

## InboxRecord

Состояния: `received`, `processing`, `processed`, `retry_wait`, `deferred`,
`failed`, `dead_letter`, `ignored`.

| From          | Event                      | Guard                                             | To            | Side effects                                               | Retry policy                            |
| ------------- | -------------------------- | ------------------------------------------------- | ------------- | ---------------------------------------------------------- | --------------------------------------- |
| —             | `webhook.accept`           | Valid signature, body ≤ 2 MB, unique provider key | `received`    | Сохранить raw valid payload и inbox record transactionally | Duplicate returns prior acknowledgement |
| —             | `webhook.accept_paused`    | Valid, project paused                             | `deferred`    | Сохранить raw payload, не enqueue                          | Resume requeues                         |
| —             | `webhook.accept_archived`  | Valid, project archived/stale connection          | `ignored`     | Сохранить только необходимый technical record              | none                                    |
| `received`    | `inbox.claim`              | Lease available, project active                   | `processing`  | Lease owner/expiry/attempt increment                       | Lease recovery                          |
| `received`    | `project.paused`           | До claim                                          | `deferred`    | Не исполнять                                               | Resume                                  |
| `processing`  | `inbox.complete`           | Normalized/domain transaction committed           | `processed`   | Clear lease, metrics                                       | none                                    |
| `processing`  | `inbox.retryable_failure`  | Attempts остаются                                 | `retry_wait`  | nextAttemptAt, safe error                                  | automatic                               |
| `retry_wait`  | `retry.due`                | Project active                                    | `received`    | BullMQ signal                                              | Relay automatic                         |
| `processing`  | `inbox.permanent_failure`  | Non-retryable validation/domain error             | `failed`      | Safe error, alert as configured                            | manual after correction                 |
| `processing`  | `inbox.attempts_exhausted` | Max attempts reached                              | `dead_letter` | DLQ visibility/alert                                       | manual                                  |
| `deferred`    | `project.resumed`          | Project active                                    | `received`    | Relay signal                                               | automatic                               |
| `failed`      | `inbox.manual_retry`       | Permission, reason, issue corrected               | `received`    | New attempt group; audit                                   | manual                                  |
| `dead_letter` | `inbox.manual_retry`       | Permission, reason                                | `received`    | New attempt group; audit                                   | manual                                  |

Невалидная подпись не создаёт `InboxRecord` и не сохраняет raw body.

## OutboxRecord

Обязательные состояния: `pending`, `processing`, `succeeded`, `failed`,
`unknown`.

| From         | Event                         | Guard                                                                 | To           | Side effects                                            | Retry policy            |
| ------------ | ----------------------------- | --------------------------------------------------------------------- | ------------ | ------------------------------------------------------- | ----------------------- |
| —            | `outbox.create`               | Создаётся в одной transaction с domain change; unique idempotency key | `pending`    | Persist intended side effect                            | Relay automatic         |
| `pending`    | `outbox.claim`                | Due, lease free/expired, dependency guards pass                       | `processing` | Lease/attempt; BullMQ job may execute                   | Lease recovery          |
| `processing` | `effect.succeeded`            | Valid provider response or reconciliation proof                       | `succeeded`  | Store safe result/external ID; update domain projection | none                    |
| `processing` | `effect.retryable_failed`     | Provider confirms no success; attempts remain                         | `failed`     | Error classification, nextAttemptAt                     | automatic               |
| `processing` | `effect.permanent_failed`     | Permanent error                                                       | `failed`     | Safe error/alert                                        | manual after correction |
| `processing` | `effect.outcome_unknown`      | Side effect мог произойти, подтверждения нет                          | `unknown`    | Reconciliation task; block blind retry                  | reconcile only          |
| `failed`     | `retry.due`                   | Retryable and attempts remain                                         | `pending`    | Clear lease, preserve logical key                       | automatic               |
| `failed`     | `outbox.manual_retry`         | Permission, reason, retry safety confirmed                            | `pending`    | New attempt group; audit                                | manual                  |
| `unknown`    | `reconciliation.succeeded`    | External system confirms application                                  | `succeeded`  | Safe result; domain projection                          | none                    |
| `unknown`    | `reconciliation.not_applied`  | External system confirms absence                                      | `pending`    | Retry now safe                                          | automatic/manual        |
| `unknown`    | `reconciliation.inconclusive` | Reconciliation budget exhausted                                       | `unknown`    | Alert/manual queue                                      | manual decision         |
| `unknown`    | `outbox.manual_retry`         | Explicit operator confirmation of risk                                | `pending`    | New attempt group, mandatory high-risk audit            | manual only             |

Relay периодически сканирует PostgreSQL, поэтому потеря BullMQ job не теряет
намерение. `IdempotencyRecord` хранит logical key, operation type, scope,
request fingerprint и последний известный result reference.

## ExternalHttpOperation

States: `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `UNKNOWN`.

| From         | Event                    | Guard                                              | To                       | Side effects                                 | Retry policy     |
| ------------ | ------------------------ | -------------------------------------------------- | ------------------------ | -------------------------------------------- | ---------------- |
| —            | `http.intent.created`    | Valid published node and project secret references | `PENDING`                | Persist operation and HTTP outbox atomically | Relay automatic  |
| `PENDING`    | `http.claim`             | Due and lease free/expired                         | `PROCESSING`             | Pin validated DNS target and claim lease     | Lease recovery   |
| `PROCESSING` | `http.response.accepted` | Bounded response and configured success rule       | `SUCCEEDED`              | Persist safe projection and mapped variables | none             |
| `PROCESSING` | `http.safe_failure`      | Confirmed response/validation failure              | `FAILED`                 | Safe code and failure branch                 | Policy/manual    |
| `PROCESSING` | `http.outcome_unknown`   | Remote side effect may have happened               | `UNKNOWN`                | Block blind retry; expose safe diagnostics   | Reconcile/manual |
| `FAILED`     | `http.retry`             | Retry policy permits and idempotency is stable     | `PENDING`                | New leased attempt, same logical operation   | bounded          |
| `UNKNOWN`    | `http.reconciled`        | Remote proves applied/not applied                  | `SUCCEEDED` or `PENDING` | Safe reconciliation result                   | reconcile only   |

SSRF/DNS/redirect rejection is a confirmed `FAILED` security result, never an
`UNKNOWN`. Request/response bodies, rendered URLs and secret values are not
state-machine metadata.
