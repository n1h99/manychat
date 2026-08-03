# Automation v2 runtime

Status reviewed: 2026-08-03, including Automation Studio 2.2.

Automation v2 executes published, immutable `ScenarioVersion` graphs. The
visual editor changes only a draft; publishing validates the graph and pins the
graph for every execution. Saving is intentionally more permissive than
publishing: disconnected nodes and empty paths remain valid draft work with
stored validation issues.

`SET_CUSTOM_FIELD` writes both the contact JSON value and its typed projection.
`CLEAR_CUSTOM_FIELD` removes that value from both representations in the same
project-scoped database transaction; it never archives or deletes the field
definition. Both nodes require an active project field at publish/test time.

## Determinism

- Conditions inspect outgoing branches in ascending explicit `priority` order.
- An output port has at most one connection unless it belongs to a branching node.
- `null` is never implicitly coerced to a string or number.
- An unguarded cycle is rejected. A cycle is guarded only if it includes durable `Delay` or `Wait for Reply`.
- One execution has a bounded budget of 100 synchronous node transitions.

## Durable continuations

`DelayedAction` and `WaitState` live in PostgreSQL. The worker polling loop is only a wake-up mechanism, so a Redis outage or worker restart cannot lose a continuation.

- `Delay` persists the next node before returning its execution to `WAITING`.
- `Wait for Reply` has one active state per project, conversation and scenario. Reply and timeout use conditional transitions, so only one can win.
- A persisted inbound Telegram event resolves active waits before normal scenario matching starts.
- A subflow creates a child execution pinned to the published target version. An awaited child resumes its parent only after terminal completion.

## Observability

`ScenarioExecution` and `NodeExecution` form the execution journal. A completed
send node records only the project-scoped Omnicus message and outbox IDs. The
operator-facing inspector resolves those references to the current Telegram
message/outbox statuses, so node completion is never presented as provider
delivery. Missing message content or an unavailable active channel identity
fails the node instead of silently completing it. Continuation scans emit safe
operational messages only; Telegram payloads, bot tokens, webhook secrets and
contact data are never included.

## External HTTP request

`EXTERNAL_HTTP_REQUEST` is a durable two-branch continuation. The runtime creates
one project-scoped `HTTP` outbox record and suspends the execution. The worker
loads the immutable published node, resolves write-only project secret
references, validates and pins the public HTTPS target, then follows exactly one
`success` or `failure` edge. Every redirect is resolved and validated again.
IPv4 and IPv6 deny lists remain separate to avoid treating all public IPv4
addresses as IPv4-mapped IPv6. If DNS returns mixed public and restricted
answers, transport is pinned to one validated public address; execution is
rejected when no public address remains.

Known responses can map explicitly selected `response.data.*` or
`response.status` values into `ScenarioExecution.variables`. Later conditions,
message templates and HTTP templates use the configured path directly (for
example `crm.leadId`); HTTP templates also expose the same values below
`variables.*` plus safe `nodes.*` status metadata.
Raw request/response content, rendered URLs and secret values are not written to
the execution journal or outbox metadata.

The editor checks active project resources before Test/Publish and selects the
affected node or connection from a validation issue. Server validation remains
authoritative for races, but its safe error codes are translated into operator
messages. Draft saving deliberately remains available so an incomplete graph
can be continued later.

Retryable known failures use the node's bounded attempt budget. An ambiguous
mutating transport result becomes `UNKNOWN`, pauses the execution and requires
operator review; it is never retried blindly. The editor's Test action performs
a separately identified bounded request without publishing or executing the
scenario.
