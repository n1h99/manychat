# External gate ledger

Status reviewed: 2026-08-03. This file records access-dependent work separately
from repository implementation. Supplying credentials never expands product
scope or authorizes destructive operations.

## Completed gates

- Railway web, API and worker services are deployed from `main` with automatic
  deployment.
- PostgreSQL/Redis, migrations, health probes and production administrator
  bootstrap are operational.
- A real Telegram bot/webhook and Cyber Pulse CRM staging project are paired.
- Cyber Pulse contracts are versioned in both directions with independent
  credentials and project-scoped routing.
- Telegram Chat v3.2 live E2E passed, including inbound edits, shared contact,
  automation/broadcast source context, reaction lifecycle, duplicate event,
  reaction-before-source and isolation.
- `userReactionEvents.supported=true` is enabled after live verification.

## Ongoing operational gates

- Maintain Railway backups and rehearse an isolated restore against the RPO
  24h/RTO 4h target.
- Keep Telegram/CRM credentials and `CHANNEL_SECRETS_KEY` only in the owning
  service environment; rotate them through the audited paths.
- Re-run the contract/live regression gate after Telegram Bot API, CRM OpenAPI,
  routing or credential-boundary changes.
- Verify the final Railway worker outcome for external side effects; a queued
  response is not delivery evidence and `UNKNOWN` is not safe to resend.
- Supply a reviewed Meta Developer app, Embedded Signup configuration, app
  secret, webhook verify token, explicit Graph API version, test WABA and test
  business phone. Then run the combined WhatsApp live acceptance checklist in
  [WHATSAPP_CLOUD_API.md](WHATSAPP_CLOUD_API.md). Repository implementation and
  mock/contract verification do not count as live Meta evidence.

## Deliberately deferred channels

Instagram is not a current blocker. It remains intentionally deferred because a
dedicated test account and provider scope have not been approved. Do not add
credentials or implement provider fields by analogy.

A future Instagram slice requires a current official provider contract, test
business assets, webhook credentials, consent policy, rate limits,
data-retention ownership and a separate implementation decision.
