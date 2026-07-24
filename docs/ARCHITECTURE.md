# Stage 0 architecture

## Runtime topology

```text
browser → apps/web
             ↓ HTTPS
          apps/api → PostgreSQL
             ↓
           Redis (readiness only)

apps/worker → BullMQ/Redis
```

PostgreSQL remains the source of truth. The Stage 0 BullMQ queue proves process
connectivity and graceful shutdown only; it does not implement inbox/outbox,
Telegram, CRM or automation behavior.

## Workspace boundaries

| Workspace                | Stage 0 responsibility                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `apps/web`               | React application shell and placeholder routes                   |
| `apps/api`               | NestJS HTTP shell, Swagger, validation, errors and health probes |
| `apps/worker`            | NestJS process, Redis probe and disposable demo queue            |
| `packages/database`      | Prisma schema, generated client factory and guarded seed         |
| `packages/config`        | Zod environment schemas                                          |
| `packages/contracts`     | Transport and health response types                              |
| `packages/shared`        | Provider-independent primitives such as correlation IDs          |
| `packages/channel-core`  | Provider-neutral channel capability types only                   |
| `packages/test-fixtures` | Safe typed fixture helper                                        |

Dependencies point inward from applications to packages. Provider adapters and
business services are intentionally absent.

## API conventions

- successful responses use `{ data, meta }`;
- errors use `{ error: { code, message, details, correlationId } }`;
- inbound `x-correlation-id` is accepted only when it matches the safe format;
- JSON structured logging is enabled through NestJS `ConsoleLogger`;
- liveness never contacts dependencies;
- readiness checks the dependencies required by that process.

## Database lifecycle

The source schema is `packages/database/prisma/schema.prisma`. Prisma configuration
and future migration ownership live in `packages/database`. Stage 0 validates and
generates the client but creates no migration. See [DATABASE.md](DATABASE.md).
