# Omnicus architecture

Status reviewed: 2026-08-02.

## Runtime topology

Omnicus is a pnpm/Turborepo monorepo deployed to Railway as three services:

- `apps/web`: React/Vite SPA plus a hardened Node static server and same-origin
  `/api` reverse proxy;
- `apps/api`: NestJS API, authenticated management endpoints, CRM service API
  and signed Telegram/WhatsApp webhooks;
- `apps/worker`: BullMQ consumers and a small readiness/liveness HTTP server.

Shared business boundaries live in packages. Applications import public
package exports and never another application's source. Important packages are
`database`, `contracts`, `automation-core`, `automation-http`,
`channel-telegram`, `channel-whatsapp`, `crm-core` and `media-core`.

## Durable processing model

PostgreSQL is authoritative. Redis/BullMQ accelerates execution and may be
reconstructed from committed records. External processing is at-least-once:

```text
provider/web/API request
  -> PostgreSQL inbox or durable intent
  -> recoverable BullMQ job
  -> normalized domain mutation
  -> PostgreSQL outbox operation
  -> provider/CRM/HTTPS side effect
  -> SUCCEEDED | FAILED | UNKNOWN
```

Stable idempotency keys prevent duplicate logical effects. A confirmed safe
failure may retry according to policy. `UNKNOWN` is never retried blindly and
requires reconciliation or an audited operator decision.

Telegram and WhatsApp webhooks acknowledge after durable inbox commit and do
not wait for automation, CRM or outbound delivery. WhatsApp verifies the exact
request bytes with the global Meta app secret before it resolves a tenant from
the WABA and phone-number identifiers. A multi-account envelope is split into
one connection-owned raw/inbox item per message or status before persistence.
Scenario waits, delays, schedules and external HTTP continuations are stored in
PostgreSQL, so worker restarts do not lose them.

## Tenant and secret boundaries

Every tenant-owned record carries `projectId`. Composite database relations and
application guards prevent cross-project contact, channel, scenario, message
and operation references.

Server and browser configuration use separate package exports. Browser bundles
accept only reviewed `VITE_*` values. Telegram tokens, WhatsApp access tokens,
CRM credentials and project HTTP secrets are encrypted or one-way hashed as
appropriate, never returned after creation, and excluded from logs, audit
metadata and runtime artifacts. The Meta app secret and webhook verify token
are application-level server configuration; only the public app/configuration
IDs needed by Embedded Signup may cross the authenticated setup boundary.

CRM inbound and outbound credentials are independent. Provider payloads pass
runtime validation and are normalized before business logic sees them.

## WhatsApp provider boundary

WhatsApp uses the official Meta-hosted Cloud API only. Every connection stores
an explicit Graph API version and safe WABA/phone-number identifiers; Omnicus
does not infer a version from provider examples. New Embedded Signup numbers
are validated against their WABA, registered with a write-only six-digit PIN,
subscribed to the app and only then activated.

The last authoritative inbound user message advances the persisted customer
service window. Free-form text, media and interactive messages re-check that
window immediately before the provider call. An approved connection-scoped
Meta template is required outside the window. Delivery callbacks are
idempotent and monotonic: accepted/SENT evidence cannot claim DELIVERED or READ,
and an older callback cannot regress a newer status.

## Automation and external HTTP

Published scenario versions are immutable. Editing produces a draft version;
drafts may be incomplete or disconnected, while publish and test execution
remain strict.

External HTTP nodes create durable HTTP outbox operations. Only HTTPS is
accepted. DNS results and every redirect are validated and pinned; private,
loopback, link-local and cloud metadata targets are blocked. Request/response
limits are bounded, project secrets are write-only, and raw bodies, rendered
URLs and secret values are absent from technical metadata.

## HTTP and health model

The API applies correlation IDs, exact-origin CORS, reviewed proxy trust,
security headers, runtime DTO validation and a stable safe error envelope. The
web server rejects malformed paths, applies CSP and distinguishes missing
assets from SPA routes.

| Process | Liveness                | Readiness                              |
| ------- | ----------------------- | -------------------------------------- |
| Web     | HTTP process responds   | built assets are present               |
| API     | NestJS process responds | PostgreSQL and Redis probes pass       |
| Worker  | health server responds  | BullMQ producer and consumer are ready |

Shutdown stops HTTP intake, consumers and connections in a bounded order.

## Production artifacts

`pnpm build` emits `.runtime/web`, `.runtime/api` and `.runtime/worker`.
Production artifacts exclude source maps, test/build tooling, Prisma CLI and
secret-bearing source configuration. Railway builds each service from the same
lockfile and applies migrations only through the designated API pre-deploy
step. See [RAILWAY.md](RAILWAY.md) and [RUNBOOK.md](RUNBOOK.md).
