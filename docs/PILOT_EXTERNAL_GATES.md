# Pilot external gates

This document separates completed local/mock work from the access and contracts
needed to validate real providers. Supplying an access item does not authorize a
production deployment by itself; deployment still requires an explicit go-ahead.

## CRM production adapter — blocked by contract

The codebase intentionally contains only `CrmClient` and the deterministic mock
adapter. Before implementing a real adapter, provide all of the following:

1. authoritative API documentation, preferably OpenAPI, including API version;
2. sandbox/base URL and a non-production credential delivery method;
3. authentication, token refresh and rate-limit rules;
4. create/update lead and inbound-message payloads, required fields, field
   mapping IDs, pipeline/stage identifiers and idempotency behaviour;
5. error taxonomy, retry-after semantics, webhook/callback contract if any, and
   reconciliation/query mechanism for unknown delivery;
6. a test project/contact with written permission to create test data.

Never send `CRM_AUTH_TOKEN` in chat or commit it. Place it only in the platform
environment after the contract has been reviewed.

## Telegram live validation — blocked by credentials and public HTTPS

The Telegram adapter, signed webhook endpoint, durable inbox/outbox and mock
transport are implemented and tested locally. A real end-to-end check needs:

1. a dedicated pilot bot token from BotFather, delivered outside Git/chat;
2. a publicly reachable HTTPS base URL for the API webhook;
3. permission to call `getMe`, `setWebhook` and `deleteWebhook` for that bot;
4. a test Telegram account/chat for sending inbound text, command, callback,
   photo and document events;
5. an agreed retention owner for the bot and its test data.

`CHANNEL_SECRETS_KEY` is generated and stored separately in the API and worker
environment; it must be the same Base64-encoded 32-byte key in both services.
The bot token and webhook secret must never be copied into source, fixtures,
screenshots, audit records or support tickets.

## Railway staging — blocked by platform access and deployment approval

No Railway deployment has been made. To validate staging, provide:

1. access to the target Railway project or an approved service invitation;
2. the intended public web/API domains and permitted CORS origin;
3. provisioned PostgreSQL and Redis service URLs via Railway variables;
4. a securely delivered set of staging values for `JWT_ACCESS_SECRET` and
   `CHANNEL_SECRETS_KEY` (and CRM credentials only after its contract gate);
5. explicit `TRUST_PROXY` topology approved for the Railway deployment;
6. backup schedule, retention, and approval to perform and document a restore
   drill against a non-production destination;
7. explicit confirmation to deploy.

Migrations must run once in a release/pre-deploy job, never in every API or
worker replica. See `docs/RUNBOOK.md` for the local recovery model.

## WhatsApp and other post-pilot channels

WhatsApp, Instagram and broadcasts are deliberately not implemented in this
pilot. Do not provide credentials yet unless their separate scope is approved.
For a future WhatsApp scope, the expected external inputs are Meta developer
access, a Business Manager/WABA, a registered test phone number, webhook
verification material, approved template policy/details, rate limits and the
current official Cloud API contract. These inputs do not expand the current
pilot scope automatically.
