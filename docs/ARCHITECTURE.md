# Stage 0 architecture

## Monorepo boundaries

- `apps/web`: React/Vite application shell and a minimal hardened production
  static server.
- `apps/api`: NestJS HTTP API with health probes and no business modules.
- `apps/worker`: NestJS/BullMQ process with an HTTP health server and a
  feature-gated demo queue only.
- `packages/database`: Prisma schema, generated client, safe CLI wrappers, and
  guarded empty seed.
- `packages/config`: separate public entry points:
  `@omnicus/config/server` and `@omnicus/config/web`.
- `packages/contracts`: cross-process DTO and error-envelope types.
- `packages/shared`: generic runtime helpers.
- `packages/channel-core`: channel abstractions only; no provider adapter.
- `packages/test-fixtures`: test-only fixtures.

Applications import package exports, never another package's internal `src`
path. Turborepo builds dependency packages before applications. Shared compiler
defaults live in `tsconfig.base.json`; Vite/browser projects explicitly use
bundler module resolution.

## Configuration boundary

Server and browser configuration are physically separated by package exports.
The web bundle can resolve only the `web` schema and accepts only `VITE_*`
values. A post-build assertion scans the production output for source maps,
server schema markers, and server variable names.

API, worker, Prisma configuration, and seed locate the repository `.env` from
their module location rather than the process working directory. A standalone
pruned API/worker artifact does not fall back to CWD when workspace markers are
absent; it validates `process.env` directly. An explicit staging/production
`APP_ENV` also disables `.env` loading, so local defaults cannot complete a
partially configured deployment. Runtime validation is fail-closed:

- `APP_ENV` is explicit;
- database and Redis URLs have protocol allowlists;
- CORS values are exact HTTP(S) origins;
- production Swagger is rejected;
- `PORT` always wins over local service defaults.

## HTTP applications

The API applies correlation IDs, exact-origin CORS, an explicit Railway-aware
proxy trust policy, baseline security headers, validation, and a stable error
envelope. Internal exceptions are logged with their correlation ID; 5xx
responses expose only a fixed code and message.

The web production server has a guarded request pipeline. Malformed percent
encoding returns `400`, missing assets return `404`, extensionless routes use
the SPA fallback, and filesystem failures return a safe `500` without
terminating the process. CSP and baseline headers are applied to every
response.

## Health model

| Process | Liveness                    | Readiness                                                                        |
| ------- | --------------------------- | -------------------------------------------------------------------------------- |
| Web     | HTTP process responds       | static build is present                                                          |
| API     | NestJS process responds     | PostgreSQL and Redis answer probes                                               |
| Worker  | worker HTTP server responds | BullMQ producer is ready and the actual consumer connection is ready and running |

The worker producer and consumer have separate connections because BullMQ
requires different blocking/retry behavior. Shutdown is ordered and bounded:
the HTTP server stops accepting requests, then the consumer, queue, and Redis
resources close within the configured timeout.

## Production artifacts

`pnpm build` emits deployable artifacts under `.runtime/`. API and worker are
assembled with `pnpm deploy --prod --legacy`, followed by a reachability pass
over pnpm's isolated dependency graph. Unreachable virtual-store entries and
all source maps are removed; Prisma CLI/config/engine tooling, TypeScript, Vite,
test tooling, database seed, and schema sources are asserted absent. Generated
Prisma and TypeScript output is cleaned before every build so removed
future-stage models cannot survive as stale runtime files. Web source maps are
disabled.

Railpack performs the lockfile-driven install once. Railway build commands only
run version/preflight checks and build the selected service plus workspace
dependencies. Details are in [RAILWAY.md](RAILWAY.md).

## Stage boundary

The executable Prisma schema is a migration-free, 14-table Stage 1 baseline
proposal. It is intentionally not the entire product data model. No Auth/RBAC
service, Project API, Contacts, Telegram, CRM, automation runtime,
transactional inbox/outbox runtime, or broadcasts are present in Stage 0.
