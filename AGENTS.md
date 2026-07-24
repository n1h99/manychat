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

Scaffold Этапа 0 реализован. До отдельного перехода к Этапу 1 разрешены только
исправления инфраструктуры monorepo и application shells. Первый pilot
ограничен:

- Auth и RBAC;
- проекты;
- контакты, теги и определения custom fields;
- Telegram;
- PostgreSQL transactional inbox/outbox;
- CRM interface и mock adapter;
- минимальный automation runtime:
  `Incoming Message → Condition → Create/Update Lead → Forward to CRM
→ Send Message → Add/Remove Tag`;
- execution log;
- Railway deployment.

До успешного завершения pilot не реализовывать:

- WhatsApp и Instagram;
- broadcasts;
- Delay и Wait for Reply;
- Subflows;
- полноценный External HTTP Request editor;
- расширенные media workflows.

## Обязательные архитектурные инварианты

- PostgreSQL — источник истины. Redis/BullMQ только исполняет и планирует jobs.
- Обработка имеет семантику at-least-once; exactly-once не обещается.
- Входящие события проходят через transactional inbox, исходящие side effects —
  через transactional outbox.
- Внешний side effect имеет idempotency key и состояния
  `pending → processing → succeeded | failed | unknown`.
- `unknown` требует reconciliation или ручного retry с audit.
- Webhook не ждёт CRM, automation runtime или outbound delivery.
- Невалидный webhook raw body не сохраняется.
- Все tenant-owned записи содержат `projectId`; связи должны исключать
  cross-project references на уровне БД и application guards.
- Бизнес-логика не зависит от provider payload. Все внешние данные проходят
  runtime validation и channel/CRM adapters.
- Реальные CRM endpoint и payload нельзя придумывать. До получения контракта
  разрешён только `CrmClient`, mock adapter и fixtures.
- Секреты не возвращаются после сохранения, не попадают в Git и логи.
- Railway Bucket считается private authenticated object storage, но не private
  network.

## Правила изменений

- Делайте небольшие логические изменения.
- Перед бизнес-кодом сверяйте текущий этап в `docs/IMPLEMENTATION_PLAN.md`.
- Перед изменением схемы данных сначала обновляйте `docs/DATABASE.md` и ADR.
- После появления Prisma schema каждое изменение БД должно иметь migration
  proposal и review. Initial migration Этапа 0 не создаётся до отдельного
  отчёта и явного разрешения.
- Не меняйте published scenario version; создавайте новую draft version.
- Не добавляйте provider fields по памяти. Проверяйте официальную документацию и
  фиксируйте проверенную API version/date.
- Не смешивайте product scope с opportunistic refactoring.

## Проверки

После реализации этапа обязательны:

```text
format check
lint
typecheck
unit tests
integration tests
production build
prisma validate
```

Во время документальной фазы запускать только проверки целостности Markdown:

- обязательные файлы существуют;
- локальные Markdown links разрешаются;
- fenced code blocks сбалансированы;
- `JWT_REFRESH_SECRET` отсутствует в environment/config lists;
- `git diff --check`, если репозиторий находится под Git.

Не запускать приложение, миграции или deploy без явного требования этапа.

## Документирование результата

Отчёт по изменению должен содержать:

- выполненный scope;
- изменённые файлы;
- принятые или затронутые ADR;
- выполненные проверки;
- оставшиеся blockers и внешние зависимости.
