# Testing

## Test layers

| Layer            | Command                 | Current Stage 0 coverage                        |
| ---------------- | ----------------------- | ----------------------------------------------- |
| Formatting       | `pnpm format:check`     | all tracked source and documentation            |
| Lint             | `pnpm lint`             | TypeScript, TSX and JavaScript                  |
| Type checking    | `pnpm typecheck`        | every workspace in strict mode                  |
| Unit             | `pnpm test`             | config, correlation ID, navigation and demo job |
| API integration  | included in `pnpm test` | Nest app boot, liveness and error envelope      |
| Browser smoke    | `pnpm test:e2e`         | web shell navigation                            |
| Production build | `pnpm build`            | all packages and three applications             |
| Prisma           | `pnpm db:validate`      | schema structure without applying SQL           |

The API integration liveness test deliberately does not require PostgreSQL or
Redis. Dependency behavior is exposed by `/health/ready` and can be exercised
against Docker Compose.

## Before a pull request

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:validate
pnpm test:e2e
```

Fixtures must not contain credentials, real provider payloads or unredacted PII.
