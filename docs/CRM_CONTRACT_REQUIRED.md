# CRM contract required

## Статус

Production CRM adapter заблокирован до предоставления и анализа реального
контракта. Запрещено выводить endpoint, payload и response shape из названий
методов или примеров Omnicus.

## Что разрешено до получения контракта

- определить provider-neutral `CrmClient` interface;
- реализовать in-memory/mock adapter;
- создать синтетические fixtures, явно помеченные как Omnicus mock format;
- тестировать inbox/outbox, mapping, retries и automation pipeline на mock;
- хранить project-specific `CrmProjectConfig`;
- реализовать redaction, correlation и idempotency plumbing.

## Минимальный provider-neutral interface

```ts
interface CrmCallContext {
  projectId: string;
  crmProjectId: string;
  correlationId: string;
  idempotencyKey: string;
}

interface CrmClient {
  createOrUpdateLead(
    context: CrmCallContext,
    input: CreateOrUpdateLeadInput,
  ): Promise<CrmLeadResult>;

  forwardInboundMessage(
    context: CrmCallContext,
    input: ForwardInboundMessageInput,
  ): Promise<CrmMessageResult>;

  syncContact(
    context: CrmCallContext,
    input: SyncContactInput,
  ): Promise<CrmSyncResult>;

  reconcileOperation?(
    context: CrmCallContext,
    input: ReconcileCrmOperationInput,
  ): Promise<CrmReconciliationResult>;
}
```

Типы `CreateOrUpdateLeadInput`, `ForwardInboundMessageInput` и результатов здесь
являются внутренними доменными контрактами Omnicus. Они не утверждают формат
реального CRM API.

## Необходимые входные материалы

Нужен хотя бы один authoritative source:

1. актуальный OpenAPI/Swagger CRM;
2. репозиторий CRM с controller/DTO/schema;
3. официальная документация API и тестовый environment;
4. подтверждённая владельцем CRM коллекция запросов вместе со схемами.

Дополнительно нужны:

- способ авторизации и rotation token;
- base URL для staging/production;
- versioning policy;
- create/update lead semantics;
- ключ поиска существующего lead;
- формат передачи channel identity и conversation;
- формат text/media/attachment messages;
- callback/event contract;
- project routing;
- idempotency support;
- rate limits;
- timeout guidance;
- retryable и permanent error codes;
- pagination, если требуется;
- максимальные request/response sizes;
- PII и retention требования;
- минимум по одному обезличенному success/error примеру каждой операции.

## Contract review checklist

Перед production implementation нужно зафиксировать:

| Область | Обязательное решение |
|---|---|
| Authentication | Заголовки, token lifetime, rotation, scopes |
| Project routing | Как `CrmProjectConfig.crmProjectId` попадает в запрос |
| Lead upsert | Natural/idempotency key и conflict semantics |
| Message forwarding | Поддерживаемые типы и attachments |
| Callback security | HMAC/secret, timestamp, replay window |
| Idempotency | Provider key, lookup/reconciliation либо ограничения |
| Errors | Retryable, permanent, validation, rate-limit |
| Timeouts | Connect/read/overall timeout |
| Limits | Payload, rate, concurrency |
| Observability | Safe request/response fields и correlation |
| Compatibility | API version и deprecation policy |

## Configuration ownership

Environment:

```text
CRM_BASE_URL
CRM_AUTH_TOKEN
```

PostgreSQL `CrmProjectConfig`:

```text
projectId
crmProjectId
fieldMapping
defaultPipeline
defaultStage
additionalParameters
status
createdAt
updatedAt
```

CRM token не копируется в PostgreSQL. Входящий CRM callback нельзя маршрутизировать
только по переданному caller-ом internal `projectId`: routing должен быть
подтверждён связью с `crmProjectId`, lead/conversation mapping и проверенной
подписью.

## Mock contract

Mock adapter должен:

- возвращать детерминированный результат по input;
- поддерживать scripted success, timeout, retryable failure, permanent failure и
  unknown outcome;
- записывать полученный idempotency key;
- обнаруживать повтор ключа без повторного mock side effect;
- не использовать URL или payload, похожий на неподтверждённый production API.

## Exit criteria блокировки

Production CRM adapter может начаться, когда:

- authoritative contract доступен и versioned;
- заполнен contract review checklist;
- mapping согласован для каждого pilot project;
- callback security подтверждена;
- определена стратегия unknown/reconciliation;
- fixtures получены из реальных обезличенных примеров;
- решение зафиксировано новым ADR.
