# Automation v2 runtime

Automation v2 executes published, immutable `ScenarioVersion` graphs. The visual editor changes only a draft; publishing validates the graph and pins the graph for every execution.

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

`ScenarioExecution` and `NodeExecution` form the execution journal. Continuation scans emit safe operational messages only; Telegram payloads, bot tokens, webhook secrets and contact data are never included.

## External HTTP request

`EXTERNAL_HTTP_REQUEST` is a durable two-branch continuation. The runtime creates
one project-scoped `HTTP` outbox record and suspends the execution. The worker
loads the immutable published node, resolves write-only project secret
references, validates and pins the public HTTPS target, then follows exactly one
`success` or `failure` edge. Every redirect is resolved and validated again.

Known responses can map explicitly selected `response.data.*` or
`response.status` values into `ScenarioExecution.variables`. Later conditions,
message templates and HTTP templates use the configured path directly (for
example `crm.leadId`); HTTP templates also expose the same values below
`variables.*` plus safe `nodes.*` status metadata.
Raw request/response content, rendered URLs and secret values are not written to
the execution journal or outbox metadata.

Retryable known failures use the node's bounded attempt budget. An ambiguous
mutating transport result becomes `UNKNOWN`, pauses the execution and requires
operator review; it is never retried blindly. The editor's Test action performs
a separately identified bounded request without publishing or executing the
scenario.
