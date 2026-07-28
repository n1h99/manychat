# Railway deployment

Stage 0 is Railway-ready but has not been deployed.

Create three services from the same repository. Keep the repository root as the
service root; each service points to its own configuration file:

- Web: `apps/web/railway.toml`
- API: `apps/api/railway.toml`
- Worker: `apps/worker/railway.toml`

Railpack reads `packageManager`, exact `engines.node=24.18.0`, and
`pnpm-lock.yaml`, so custom build commands do not run a second install. Each
build logs actual Node/pnpm versions, runs the strict preflight, and builds only
the selected application plus its workspace dependencies.

| Service | Build command                                          | Start command                       | Health path     |
| ------- | ------------------------------------------------------ | ----------------------------------- | --------------- |
| web     | `pnpm versions && pnpm preflight && pnpm build:web`    | `node .runtime/web/server.mjs`      | `/health/ready` |
| api     | `pnpm versions && pnpm preflight && pnpm build:api`    | `node .runtime/api/dist/main.js`    | `/health/ready` |
| worker  | `pnpm versions && pnpm preflight && pnpm build:worker` | `node .runtime/worker/dist/main.js` | `/health/ready` |

All HTTP servers bind `0.0.0.0` and use Railway's `PORT` regardless of
`APP_ENV`. The worker owns a small HTTP health server on that same process/port;
readiness covers both the BullMQ producer and actual consumer.

## Variables

Shared server variables:

- `NODE_ENV=production`
- `APP_ENV=production` (or `staging` for a staging environment)
- `DATABASE_URL` using `postgres://` or `postgresql://`
- `REDIS_URL` using `redis://` or `rediss://`
- `CORS_ALLOWED_ORIGINS` as one or more comma-separated exact HTTP(S) origins
- `TRUST_PROXY` is required in staging/production. Until Railway ingress CIDRs
  and X-Forwarded-For overwrite behavior are explicitly verified, use a
  fail-closed reviewed value; do not trust broad private ranges by default.
- `SWAGGER_ENABLED=false`
- `RAILPACK_PRUNE_DEPS=true`

Web build:

- `VITE_API_URL`: required exact API base URL for staging/production builds.
  The browser does not call that cross-site origin directly: the production web
  server uses it as the upstream for its same-origin `/api` reverse proxy.

API:

- `API_PORT` is only a local fallback; Railway `PORT` wins.
- `API_PUBLIC_URL` is the exact public HTTPS origin of the API service, for
  example `https://${{RAILWAY_PUBLIC_DOMAIN}}`. Telegram webhook URLs are
  derived only from this server-owned value; clients cannot override it.

Worker:

- `WORKER_PORT` is only a local fallback; Railway `PORT` wins.
- `WORKER_SHUTDOWN_TIMEOUT_MS` and `BULLMQ_READY_TIMEOUT_MS` may override
  bounded defaults.
- `DEMO_JOB_ENABLED` must remain false in staging/production; validation rejects
  an enabled value there.
- `CRM_INTEGRATION_ENABLED=true`, `CRM_BASE_URL`, and `CRM_AUTH_TOKEN` enable
  Omnicus-to-Cyber-Pulse delivery. `CRM_BASE_URL` must use HTTPS in
  staging/production.
- `CRM_REQUEST_TIMEOUT_MS`, `CRM_OUTBOX_INTERVAL_MS`, and
  `CRM_OUTBOX_LEASE_MS` have bounded defaults.

API:

- `CRM_INBOUND_ENABLED=true` and `CRM_INBOUND_AUTH_TOKEN` enable the independent
  Cyber-Pulse-to-Omnicus service API.
- `CRM_INBOUND_AUTH_TOKEN` must not equal `CRM_AUTH_TOKEN`; the credentials have
  opposite trust directions and rotate independently.

Never commit real CRM credentials, database credentials, Redis credentials, or
Railway-generated values. `.railway/` is ignored.

## Networking and health

In production the SPA sends application API requests to `/api` on the web
origin. The lightweight web server forwards those requests to `VITE_API_URL`
without exposing the upstream origin to application code. Browser
authentication uses a persistent bearer session in `localStorage`; the proxy
is no longer relied upon for refresh-cookie persistence. Telegram webhooks
continue to use the API service's `API_PUBLIC_URL` directly.

Use Railway private service URLs for PostgreSQL/Redis where Railway provides
them, while still treating credentials and transport security as required
controls. Private networking is not a substitute for authentication or
encryption.

The web readiness probe confirms its built assets, API readiness probes
PostgreSQL and Redis, and worker readiness requires a running BullMQ consumer.
Failed dependency probes return `503`.

## Migration flow

There is no approved migration in Stage 0 and no `preDeployCommand` is
configured.

After a migration receives the required schema/SQL report and approval, use
exactly one designated release/migrator service or one designated API
pre-deploy step to run `prisma migrate deploy` with the real `DATABASE_URL`.
Do not configure that command on web/worker services, in replica start
commands, or independently on multiple services. Application replicas start
only after the single-run migration succeeds. Rollback and restore procedures
must be rehearsed before the first production use.
