# Omnicus documentation index

Status reviewed: 2026-08-03, `main` at Automation Studio 2.2, Telegram Chat
v3.3, platform operations completion and Automation Activity.

## Current product status

- Railway runs the web, API and worker services from `main`; deployments are
  automatic after a push.
- All operator mutations expose action-specific success/failure feedback. Safe
  API codes and validation field names are translated into actionable UI copy;
  internal 5xx details remain hidden behind a correlation reference.
- Project workspaces now include an Operations & Audit Center with safe bounded
  inbox/outbox/automation/broadcast projections, reasoned terminal retry and
  evidence-based `UNKNOWN` reconciliation. Raw payloads, message content and
  credentials are not selected into these responses.
- Account lifecycle is complete for the current operator-delivered model:
  global/project invitations, hashed expiring single-use links, invitation
  acceptance, password-reset requests, one-time admin-generated reset links and
  active-session revocation after reset. No email provider contract is invented.
- Built-in global/project roles remain immutable; authorized operators can
  create custom roles from scope-safe permission catalogs. Project Settings can
  update general metadata and make a safe draft clone containing only general
  settings and custom role definitions.
- Permission-guarded System Health combines PostgreSQL, Redis and worker probes with
  queue pressure, global audit history and current terminal operations from the
  last 24 hours. Older unresolved journal records remain visible separately by
  project and do not make the live platform status look degraded. Each operation
  count links to the matching filtered project journal. Sentry is not used and
  Railway backup configuration remains operator-owned.
- Automation Activity is available only inside each authorized project workspace,
  not as a duplicate global sidebar destination. The board provides paginated
  contact journeys, current steps, safe reasons, per-step timelines, exact status
  totals and bounded trend/scenario/drop-off charts from existing execution
  journals. It never selects contact variables, event payloads or raw provider
  errors.
- Project overview shows project identity, status, locale, timezone and lifecycle
  information only. Tool navigation stays in the dedicated Project sections grid
  and is not duplicated in the overview.
- Permission, audit, health, operation and status codes are translated into
  plain-language UI labels. Action buttons keep accessible names without
  rendering intrusive hover tooltips.
- Telegram and Cyber Pulse CRM are the active live integration slice.
- Every normalized Telegram inbound message is queued to an active paired CRM
  independently of Automation Studio. Inbound replies keep a same-conversation
  Omnicus message reference through contract 3.2.3.
- Telegram Chat v3.2 live E2E passed for inbound edits, shared contacts,
  automation/broadcast `sourceContext`, reaction add/change/remove, duplicate
  delivery, reaction-before-source and routing isolation.
- Connection-scoped discovery advertises
  `userReactionEvents.supported=true`.
- Telegram Chat v3.3 adds bounded reply keyboards/Force Reply, application-owned
  DAILY/WEEKLY recurring schedules with revision-safe updates, native Telegram
  rich Markdown messages and rich draft previews that reuse provider media IDs.
- Rich content never accepts arbitrary media URLs; durable media is resolved
  only from a project/connection-scoped Omnicus asset.
- CRM history now requires both a numeric Telegram provider message ID and a
  matching `SUCCEEDED` Telegram outbox; synthetic rows cannot become chat
  bubbles. Channel pipeline failures/unknown outcomes raise safe UI
  notifications when the operator is viewing that channel.
- Automation Studio 2.2 supports incomplete/disconnected drafts, explicit
  operator-controlled saving, edge deletion and durable SSRF-safe External
  HTTP nodes. Editor changes remain local until **Save draft** is pressed. The
  editor now hydrates one stable saved baseline, refreshes version history
  immediately, previews each immutable canvas, keeps connection handles stable,
  and exposes only graph-relevant Safe Test controls.
- Automation authoring validates active tags, custom fields, templates,
  subflows and HTTP secrets before Test/Publish. Incomplete drafts remain
  saveable, while disconnected nodes are blocking issues. **Clear custom
  field** removes one current-contact value without deleting its project field
  definition.
- Automation execution diagnostics distinguish node completion from actual
  Telegram delivery. Send steps persist only safe message/outbox references;
  missing content or channel identity fails the step instead of reporting a
  false success.
- External HTTP DNS pinning keeps IPv4 and IPv6 deny lists separate and selects
  a public resolved address when a platform resolver also returns restricted
  addresses. Private, loopback, mapped, reserved and redirect targets remain
  blocked.
- WhatsApp and Instagram are deliberately deferred until test accounts and a
  separately approved scope exist.

The Telegram channel-detail cache refresh issue found during the current
verification cycle is resolved: disable/connect mutations update the active
detail immediately. Broad manual/live acceptance remains intentionally grouped
into the final verification stage.

## Active references

| Area                                   | Authoritative document                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Architecture and trust boundaries      | [ARCHITECTURE.md](ARCHITECTURE.md)                                     |
| Product stages and follow-ups          | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)                       |
| Accepted decisions                     | [DECISIONS.md](DECISIONS.md)                                           |
| Prisma schema and migration invariants | [DATABASE.md](DATABASE.md)                                             |
| Automation semantics                   | [AUTOMATION_ENGINE.md](AUTOMATION_ENGINE.md)                           |
| Durable lifecycle rules                | [STATE_MACHINES.md](STATE_MACHINES.md)                                 |
| Operations and incident recovery       | [RUNBOOK.md](RUNBOOK.md)                                               |
| Railway topology                       | [RAILWAY.md](RAILWAY.md)                                               |
| Test gates                             | [TESTING.md](TESTING.md)                                               |
| Cyber Pulse integration                | [CRM_INTEGRATION.md](CRM_INTEGRATION.md)                               |
| CRM-to-Omnicus OpenAPI                 | [OMNICUS_CRM_OUTBOUND_OPENAPI.yaml](OMNICUS_CRM_OUTBOUND_OPENAPI.yaml) |
| Omnicus-to-CRM OpenAPI                 | [OMNICUS_TO_CRM_OPENAPI.yaml](OMNICUS_TO_CRM_OPENAPI.yaml)             |
| Pairing OpenAPI                        | [CRM_PAIRING_OPENAPI.yaml](CRM_PAIRING_OPENAPI.yaml)                   |

## Historical and handoff references

The following files are retained for audit/history and are not current blockers:

- [CRM_CONTRACT_REQUIRED.md](CRM_CONTRACT_REQUIRED.md): original CRM contract
  gate, satisfied by the published Cyber Pulse contracts.
- [CRM_OUTBOUND_HISTORY_HANDOFF.md](CRM_OUTBOUND_HISTORY_HANDOFF.md): completed
  outbound-history handoff.
- [CRM_TELEGRAM_STICKER_MEDIA_HANDOFF.md](CRM_TELEGRAM_STICKER_MEDIA_HANDOFF.md):
  completed 3.1 media handoff; current capability values come from v3.3
  discovery and OpenAPI.
- [PILOT_EXTERNAL_GATES.md](PILOT_EXTERNAL_GATES.md): gate ledger showing what
  is complete and what remains deliberately deferred.
- [STAGE1_BASELINE_SQL_PROPOSAL.sql](STAGE1_BASELINE_SQL_PROPOSAL.sql): retained
  Stage 1 SQL review artifact, not the current full schema.

When prose and executable behavior differ, the OpenAPI contracts, Prisma
schema, accepted ADRs and capability response take precedence over historical
handoff text.
