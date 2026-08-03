# Railway deployment

Status reviewed: 2026-08-03. Omnicus is deployed on Railway from `main`; pushes
to `origin/main` trigger the configured web, API and worker deployments.

## Services

All three services use the repository root and the same lockfile:

| Service | Config                     | Start command                       | Health path     |
| ------- | -------------------------- | ----------------------------------- | --------------- |
| Web     | `apps/web/railway.toml`    | `node .runtime/web/server.mjs`      | `/health/ready` |
| API     | `apps/api/railway.toml`    | `node .runtime/api/dist/main.js`    | `/health/ready` |
| Worker  | `apps/worker/railway.toml` | `node .runtime/worker/dist/main.js` | `/health/ready` |

Railpack reads the exact Node/pnpm versions from the repository and builds only
the selected service plus its workspace dependencies. All servers bind
`0.0.0.0`; Railway's `PORT` overrides local defaults.

## Core variables

Shared API/worker values include `APP_ENV`, `DATABASE_URL`, `REDIS_URL`,
`CHANNEL_SECRETS_KEY` and the reviewed proxy/health settings from
`.env.example`. The API additionally requires `JWT_ACCESS_SECRET`,
`API_PUBLIC_URL`, `CORS_ALLOWED_ORIGINS` and `CRM_INBOUND_ENABLED`. The worker
uses `CRM_INTEGRATION_ENABLED` and the bounded worker/continuation and
WhatsApp recovery intervals.

The API WhatsApp app boundary additionally uses
`WHATSAPP_META_APP_ID`, `WHATSAPP_META_APP_SECRET`,
`WHATSAPP_META_CONFIGURATION_ID`, `WHATSAPP_GRAPH_API_VERSION` and
`WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`. The app secret and verify token are
server-only. Connected phone access tokens are encrypted project credentials,
not shared Railway variables. Missing Meta values keep WhatsApp setup
unavailable without degrading Telegram or the platform health probes.

The web build requires `VITE_API_URL`, which is used server-side as the upstream
for the same-origin `/api` proxy. Browser code must not receive database, Redis,
CRM, Telegram, media bucket or project-secret credentials.

Media storage requires the `MEDIA_BUCKET_*` values and
`MEDIA_STORAGE_ENABLED=true`. CRM inbound and outbound credentials are
different values. New project pairings store project-scoped credentials; the
global `CRM_BASE_URL`, `CRM_AUTH_TOKEN` and `CRM_INBOUND_AUTH_TOKEN` values are
compatibility inputs only for the legacy paired project.

Never commit Railway variables or paste them into logs, documentation or test
fixtures. `.railway/` is ignored.

## Networking and health

- Web serves the SPA and proxies `/api` to the API origin.
- Telegram and Meta call public API webhooks derived from server-owned
  `API_PUBLIC_URL`. Meta's app-level WhatsApp callback is
  `/webhooks/whatsapp` and requires exact raw-body HMAC verification.
- API readiness probes PostgreSQL and Redis.
- Worker readiness requires both its BullMQ producer and running consumer.
- Dependency failure returns `503`; liveness stays independent of external
  dependencies.

Railway private networking does not replace authentication or encryption.
`TRUST_PROXY` must match the reviewed ingress topology and must not trust broad
ranges by convenience.

## Migration flow

The executable schema has reviewed migrations through
`20260803000100_whatsapp_cloud_api`. Exactly one designated API
pre-deploy step runs:

```text
pnpm db:migrate:deploy
```

Do not run migrations from web, worker, replica start commands or multiple
services. A failed migration blocks the new application release. Never use
`prisma db push` against Railway.

The one-time administrator bootstrap is a separate, explicitly enabled API
pre-deploy operation. Remove all bootstrap variables immediately after it
succeeds. Details and incident procedures are in [RUNBOOK.md](RUNBOOK.md).
