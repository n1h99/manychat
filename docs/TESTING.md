# Testing

Status reviewed: 2026-08-02.

## Local quality gate

Run with the pinned Node/Corepack toolchain:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm versions
corepack pnpm preflight
corepack pnpm format:check
corepack pnpm lint
corepack pnpm check:boundaries
corepack pnpm db:validate
corepack pnpm db:diff:check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:api:production
corepack pnpm test:web:production
corepack pnpm test:worker:production
corepack pnpm test:e2e
corepack pnpm audit:production
```

`db:diff:check` verifies the complete executable Prisma schema against the
ordered reviewed migrations and database invariants. It does not apply schema
changes. Production smoke suites exercise the assembled `.runtime` artifacts,
not development servers.

## Coverage expectations

Every durable integration must cover success, retryable failure, permanent
failure, timeout/`UNKNOWN`, reconciliation, lease recovery, stable idempotency
and project isolation. A queued operation is never asserted as delivered.

Telegram/CRM contract tests additionally cover duplicate delivery,
reaction-before-source, incorrect routing, media ownership, scheduled-message
reconciliation and source-context persistence. Live verification is recorded
separately because mock or unit coverage is not evidence of provider delivery.

Automation tests cover deterministic graph execution, branch selection,
wait/delay/subflow continuation, immutable published versions and execution
journaling. Automation Studio 2.2 adds explicit coverage for:

- saving incomplete/disconnected drafts while publish/test stays strict;
- explicit draft save without background update requests, plus explicit
  connection deletion;
- External HTTP method/query/header/body validation and response mapping;
- project-secret isolation and write-only secret values;
- DNS/redirect validation, SSRF and cloud-metadata blocking;
- request/response/time limits, idempotency and HTTP outbox recovery.

## Service-backed integration tests

API readiness and worker consumer tests require
`RUN_SERVICE_INTEGRATION=true` plus isolated PostgreSQL and Redis URLs. CI
provides both services. Without them, local suites explicitly skip the
service-backed cases; a skip is not runtime evidence.

## CI

CI uses the exact `.node-version`, pnpm version and frozen lockfile. It runs
format, lint, boundaries, typecheck, unit/integration tests, Prisma validation,
migration diff checks, production builds/smokes, Playwright and production
dependency audit. A Windows checkout job guards LF normalization.

High or critical production advisories fail CI. Temporary exceptions must meet
[DEPENDENCY_EXCEPTIONS.md](DEPENDENCY_EXCEPTIONS.md); findings are never
silently ignored.
