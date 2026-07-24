# Omnicus

Stage 0 infrastructure scaffold for the Omnicus pilot. The repository contains
application shells and shared infrastructure only; business modules start in later
stages.

## Prerequisites

- Node.js 24.x;
- pnpm 10.5.0 through Corepack;
- Docker with Compose for local PostgreSQL and Redis.

## Local setup

```powershell
corepack enable
corepack prepare pnpm@10.5.0 --activate
Copy-Item .env.example .env
pnpm install --frozen-lockfile
docker compose up -d postgres redis
pnpm db:validate
pnpm db:generate
```

The Prisma schema is validated and the client is generated, but Stage 0 contains
no migration. Do not run `prisma migrate dev` until the proposed SQL has been
reviewed and the migration is explicitly approved.

## Run applications

Use separate terminals with the variables from `.env` loaded:

```powershell
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

Or start all development processes with `pnpm dev`. The default endpoints are:

- web: `http://localhost:5173`;
- API Swagger: `http://localhost:3000/docs`;
- API live/readiness: `/health/live`, `/health/ready`;
- worker live/readiness: port `3001`, `/health/live`, `/health/ready`.

The worker enqueues one disposable `system-health/demo-job` in development and
test. It contains no domain behavior.

## Quality commands

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:validate
pnpm test:e2e
```

`pnpm db:seed` is guarded and only executes in development or test. The Stage 0
seed checks connectivity and deliberately creates no users or business records.

## Production commands

```text
pnpm build:web       pnpm start:web
pnpm build:api       pnpm start:api
pnpm build:worker    pnpm start:worker
```

Railway setup, configuration-file paths and environment variables are documented
in [docs/RAILWAY.md](docs/RAILWAY.md). No deployment is performed by this
repository setup.

## Architecture and operations

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Decisions](docs/DECISIONS.md)
- [Railway](docs/RAILWAY.md)
- [Runbook](docs/RUNBOOK.md)
- [Testing](docs/TESTING.md)
