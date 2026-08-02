# External gate ledger

Status reviewed: 2026-08-02. This file records access-dependent work separately
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

## Deliberately deferred channels

WhatsApp and Instagram are not current blockers. They are intentionally
deferred because dedicated test accounts have not been created and the user has
not approved their provider scope. Do not add credentials or implement provider
fields by analogy.

A future WhatsApp/Instagram slice requires current official provider contracts,
test business assets/accounts, webhook credentials, consent/template policy,
rate limits, data-retention ownership and a separate implementation decision.
