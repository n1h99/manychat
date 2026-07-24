# Testing

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
corepack pnpm test:e2e
corepack pnpm audit:production
```

`test:web:production` exercises the built Node web server, including malformed
URL handling, SPA fallback, missing assets, health endpoints, normal assets,
and a simulated file-read failure. Playwright also builds the web application
and starts `pnpm start:web`; it does not use the Vite development server.

`db:diff:check` asks Prisma for SQL from the empty schema to the executable
Stage 1 proposal, compares it byte-for-byte with the reviewed SQL proposal, and
asserts its table/FK/index invariants. It does not create or apply a migration.

## Service-backed integration tests

API readiness and worker consumer tests run when
`RUN_SERVICE_INTEGRATION=true` and valid test PostgreSQL/Redis URLs are
available. CI supplies isolated PostgreSQL and Redis service containers.
Without those services, the relevant tests are explicitly skipped; a passing
skip is not evidence that runtime connectivity works.

The worker readiness suite also includes pure state tests for the asymmetric
cases:

- producer ready, consumer failed;
- producer failed, consumer ready.

## CI

The primary workflow uses the exact pnpm version and `.node-version`, a frozen
lockfile, PostgreSQL/Redis services, format/lint/typecheck/tests/build, Prisma
validation and SQL review, production web regression tests, production
Playwright, worker HTTP readiness smoke, and a production dependency audit.

A separate Windows job sets `core.autocrlf=true` before checkout and verifies a
frozen install plus `format:check`, guarding the LF normalization policy in a
clean clone.

High or critical production dependency advisories fail CI. Any future temporary
exception must satisfy [DEPENDENCY_EXCEPTIONS.md](DEPENDENCY_EXCEPTIONS.md);
new findings are never silently ignored.
