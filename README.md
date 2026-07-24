# Omnicus

Omnicus is a `pnpm`/Turborepo monorepo. The current repository contains Stage 0
infrastructure only: a React shell, a NestJS API, a BullMQ worker, shared
packages, a stage-sliced Prisma proposal, tests, and deployment configuration.
No Stage 1 business capability is implemented.

## Required toolchain

- Node.js `24.13.0` (pinned in `.node-version`)
- pnpm `10.5.0` through Corepack (pinned by `packageManager`)
- Docker Desktop or Docker Engine with Compose, when local PostgreSQL and Redis
  are needed

The repository uses `engine-strict=true`. `preinstall` and `pnpm preflight`
also fail when Node is not major 24 or pnpm is not exactly 10.5.0. Root scripts
invoke the same Corepack/pnpm process that started them; they do not search for
an unrelated global `pnpm`.

```bash
corepack enable
corepack install
corepack pnpm versions
corepack pnpm preflight
```

## Local setup

```bash
cp .env.example .env
corepack pnpm install --frozen-lockfile
docker compose up -d postgres redis
corepack pnpm db:validate
corepack pnpm db:generate
corepack pnpm dev
```

On PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env
```

Default endpoints:

- Web: `http://localhost:5173`
- API liveness/readiness: `http://localhost:3000/health/live` and
  `http://localhost:3000/health/ready`
- Swagger in local development only: `http://localhost:3000/docs`
- Worker liveness/readiness: `http://localhost:3001/health/live` and
  `http://localhost:3001/health/ready`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

The API readiness probe checks PostgreSQL and Redis. Worker readiness checks
both the BullMQ producer connection and an actual running BullMQ consumer.
Liveness does not require dependencies.

The worker does not enqueue a demo job by default. To exercise the Stage 0
queue locally, use `APP_ENV=development` together with
`DEMO_JOB_ENABLED=true`. The flag is rejected for staging and production.

## Commands

```bash
corepack pnpm dev
corepack pnpm dev:web
corepack pnpm dev:api
corepack pnpm dev:worker

corepack pnpm format:check
corepack pnpm lint
corepack pnpm check:boundaries
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm db:validate
corepack pnpm db:diff:check
corepack pnpm test:api:production
corepack pnpm test:web:production
corepack pnpm test:e2e
corepack pnpm audit:production
```

`pnpm build` produces production runtime artifacts under `.runtime/`:

- `.runtime/web`: static web build plus the small Node static server;
- `.runtime/api`: API output with production dependencies only;
- `.runtime/worker`: worker output with production dependencies only.

Production web builds require an explicit `VITE_API_URL`. Production and
staging API/worker processes require all variables described in
[Railway deployment](docs/RAILWAY.md); invalid or missing configuration stops
the build or process.

## Database safety

The executable Prisma schema is only the proposed Stage 1 baseline for
Auth/RBAC/Projects plus infrastructure. It contains no migration and must not be
applied yet. Full future-domain models remain documentation proposals.

`db:validate`, `db:generate`, and `db:diff:check` may use the explicit
non-connecting CI placeholder configured by their wrapper. Migration commands
never receive that placeholder and require a real PostgreSQL URL.

Development/test seeding is deliberately opt-in:

```bash
APP_ENV=development \
ALLOW_DATABASE_SEED=true \
SEED_DATABASE_NAME_CONFIRMATION=omnicus \
DATABASE_URL=postgresql://omnicus:omnicus@localhost:5432/omnicus \
corepack pnpm --filter @omnicus/database db:seed
```

The seed rejects staging/production, Railway, database-name mismatches, and
remote hosts unless an additional remote opt-in is supplied. It currently
creates no business data.

Before the first migration, follow the approval and SQL-review checklist in
[Database design](docs/DATABASE.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Database design and invariants](docs/DATABASE.md)
- [Stage 1 baseline generated SQL proposal](docs/STAGE1_BASELINE_SQL_PROPOSAL.sql)
- [State machines](docs/STATE_MACHINES.md)
- [Testing](docs/TESTING.md)
- [Railway deployment](docs/RAILWAY.md)
- [Dependency exception policy](docs/DEPENDENCY_EXCEPTIONS.md)
- [Required CRM contract](docs/CRM_CONTRACT_REQUIRED.md)
