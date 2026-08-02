# OMNICUS — инструкция для агентов

## Область действия

Этот файл действует для всего репозитория.

## Источники требований

Приоритет источников:

1. явный запрос пользователя;
2. `OMNICUS_GLOBAL_TECH_SPEC_CODEX.md`;
3. принятые ADR в `docs/DECISIONS.md`;
4. формальные state machines в `docs/STATE_MACHINES.md`;
5. поэтапный план в `docs/IMPLEMENTATION_PLAN.md`;
6. остальные документы в `docs/`.

При конфликте нельзя молча выбирать вариант. Зафиксируйте конфликт в
`docs/DECISIONS.md` или запросите решение пользователя.

## Текущий статус

Pilot и утверждённые post-pilot slices реализованы и развёрнуты из `main`:

- Auth, RBAC, пользователи и проекты;
- Contacts v2, теги, custom fields, segments и manual merge;
- Telegram transactional inbox/outbox и channel management;
- Cyber Pulse CRM pairing и versioned contracts в обоих направлениях;
- broadcasts, media storage, templates и retention;
- Automation v2, Delay, Wait for Reply и Subflows;
- Automation Studio 2.1 и 2.2, включая incomplete drafts и безопасный
  `EXTERNAL_HTTP_REQUEST`;
- Telegram Chat v3.3, включая recurring schedules, reply keyboards, native
  rich messages и live-verified user reaction events;
- Railway web/API/worker deployment с automatic deploy из `main`.

Исторические этапы в `docs/IMPLEMENTATION_PLAN.md` не ограничивают уже
утверждённый и реализованный scope. Текущая сводка находится в
`docs/README.md`.

До отдельного явного решения пользователя не реализовывать:

- WhatsApp и Instagram;
- external action callbacks без утверждённого безопасного callback contract.

Provider limitations нельзя превращать в выдуманный product contract.
External Telegram deletion events и message-effect catalog остаются
capability-gated, пока Telegram Bot API не предоставляет надёжную возможность.

## Обязательные архитектурные инварианты

- PostgreSQL — источник истины. Redis/BullMQ только исполняет и планирует jobs.
- Обработка имеет семантику at-least-once; exactly-once не обещается.
- Входящие события проходят через transactional inbox, исходящие side effects —
  через transactional outbox.
- Внешний side effect имеет idempotency key и состояния
  `pending → processing → succeeded | failed | unknown`.
- `unknown` требует reconciliation или ручного retry с audit; blind retry
  запрещён.
- Webhook не ждёт CRM, automation runtime или outbound delivery.
- Невалидный webhook raw body не сохраняется.
- Все tenant-owned записи содержат `projectId`; связи исключают cross-project
  references на уровне БД и application guards.
- Бизнес-логика не зависит от provider payload. Все внешние данные проходят
  runtime validation и channel/CRM adapters.
- Реальные CRM endpoint и payload нельзя придумывать. Изменение интеграции
  требует authoritative versioned contract.
- Секреты не возвращаются после сохранения, не попадают в Git и логи.
- Railway Bucket считается private authenticated object storage, но не private
  network.

## Правила изменений

- Делайте небольшие логические изменения.
- Перед бизнес-кодом сверяйте текущий scope в `docs/IMPLEMENTATION_PLAN.md` и
  `docs/README.md`.
- Перед изменением схемы данных сначала обновляйте `docs/DATABASE.md` и ADR.
- Каждое изменение Prisma schema должно иметь новую reviewed migration. Не
  изменяйте уже применённые migration files.
- Не меняйте published scenario version; создавайте новую draft version.
- Не добавляйте provider fields по памяти. Проверяйте официальную документацию
  и фиксируйте проверенную API version/date.
- Не смешивайте product scope с opportunistic refactoring.
- WhatsApp/Instagram и другие отложенные capabilities не входят в соседние
  задачи автоматически.

## Проверки

После реализации логического этапа обязательны:

```text
format check
lint
typecheck
unit tests
integration tests
production build
prisma validate
```

Широкую ручную/live приёмку можно объединить в финальный пользовательский этап,
но автоматические safety checks перед commit/push не пропускаются.

Во время чисто документальной фазы запускать только проверки целостности
Markdown:

- обязательные файлы существуют;
- локальные Markdown links разрешаются;
- fenced code blocks сбалансированы;
- `JWT_REFRESH_SECRET` отсутствует в environment/config lists;
- `git diff --check`, если репозиторий находится под Git.

Не запускать миграции или destructive cleanup без явного требования и проверки
точного target. Railway deploy выполняется автоматикой после разрешённого push в
`main`.

## Документирование результата

Отчёт по изменению должен содержать:

- выполненный scope;
- изменённые файлы;
- принятые или затронутые ADR;
- выполненные проверки;
- оставшиеся blockers и внешние зависимости.
