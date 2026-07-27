# Operations runbook — Stage 3B.3b

## Automation continuations

Inspect `wait_states` with `status = 'ACTIVE'` and `delayed_actions` with
`status = 'PENDING'` when diagnosing paused executions. The worker scans due
records using `AUTOMATION_CONTINUATION_INTERVAL_MS`; restarting a worker does
not lose them because PostgreSQL is authoritative. Do not mutate continuation
rows manually: use the execution journal and a controlled operational retry
after diagnosing a dependency failure.

## Health probes

- web `/health/live`: static server process is accepting requests;
- API `/health/live`: API process is accepting requests;
- API `/health/ready`: PostgreSQL and Redis answer probes;
- worker `/health/live`: worker HTTP process is accepting requests;
- worker `/health/ready`: a BullMQ queue operation completes through Redis.

Readiness failure must remove a service from traffic; it must not trigger schema
changes or migration commands.

## Graceful shutdown

API shutdown hooks close Prisma and Redis clients. Worker shutdown hooks stop the
BullMQ consumer before closing its queue connection. Railway should send the
normal termination signal and allow the process to exit before force termination.

## Local dependency recovery

```powershell
docker compose ps
docker compose logs postgres redis
docker compose restart postgres redis
```

After recovery, verify API and worker `/health/ready`.

## Database changes

There is no Stage 0 migration. Never use `prisma db push` against shared or
production databases. The initial migration requires:

1. successful `pnpm db:validate`;
2. reviewed generated SQL;
3. tenant constraint review against `docs/DATABASE.md`;
4. an explicit approval and migration report.

## Backup restore

The accepted pilot targets are RPO 24 hours and RTO 4 hours. A real restore test
has not yet been performed because Stage 0 has no deployed database. Before pilot
deployment, record backup identifier, restore destination, timestamps, integrity
checks, measured RPO/RTO and cleanup confirmation in an operations report.

## Telegram inbound recovery and dead letters

A valid Telegram webhook first commits `RawWebhookEvent` and a pending
`InboxRecord` to PostgreSQL. The subsequent BullMQ enqueue is best-effort. If
Redis is unavailable, Telegram still receives HTTP 200 and the pending inbox
record remains the source-of-truth recovery candidate. Do not replay the
provider request body or manually alter the raw event.

Worker recovery periodically queries a bounded batch of due `PENDING` and
`RETRY` records, plus `PROCESSING` records whose lease has expired. It adds a
job containing only `inboxRecordId`; BullMQ's stable
`telegram-inbound-<inboxRecordId>` job ID makes concurrent workers safe. An
enqueue failure only creates a safe `recovery_enqueue_failed` log event: the
PostgreSQL record remains due for the next scan.

Retryable processing errors clear the lease, store a safe error code and set a
capped exponential `nextAttemptAt` with bounded deterministic jitter. A
malformed payload, broken required relation, or exhausted `maxAttempts` becomes
`DEAD_LETTER`; the retained raw webhook event is never deleted by this flow.
Unsupported updates complete normally.

To inspect work, query `inbox_records` by `status`, `nextAttemptAt`, `lockedAt`,
and `lastError` through a controlled operations session. Never log or copy raw
payloads, bot tokens, webhook secrets, ciphertext, or contact PII into an
incident ticket. A future operations endpoint will call the internal audited
manual-retry service for `DEAD_LETTER` / `FAILED` records. It moves only a
terminal record to `RETRY`; it resets attempts only when explicitly requested,
and falls back to the recovery scan if its immediate enqueue fails.

On worker crash, an active lease is left untouched until its configured expiry;
then recovery atomically releases it for retry. Lease-token conditional updates
prevent a late pre-crash worker from completing or releasing a newer claim.

## Telegram outbound recovery

The worker scans due `outbox_records` in `PENDING` or `RETRY`, plus expired
`PROCESSING` leases, and re-enqueues a stable `telegram-outbound-<outboxId>` job.
If Redis is unavailable after the database transaction commits, the record stays
recoverable and delivery is not lost. `UNKNOWN` delivery is terminal: reconcile
the provider outcome before any manual resend, because a timeout can occur after
Telegram accepted the request. Do not expose, log, or copy channel credentials
while investigating a record.

## Telegram broadcasts

Telegram broadcasts persist an immutable recipient snapshot before they create
individual outbound `Message` and `OutboxRecord` rows. The worker prepares due
`SCHEDULED` broadcasts and leased `PREPARING` broadcasts in bounded batches;
the preparation lease makes concurrent worker replicas safe. A Redis failure
after the database commit does not lose recipients: the existing outbox
recovery scan re-enqueues their stable jobs.

Use the broadcast status and recipient status journal for investigation. Do
not modify recipient rows directly. Pausing prevents a queued record from
calling Telegram; cancelling cancels unsent recipients. A provider result that
is `UNKNOWN` is not automatically resent, because Telegram may have accepted
the message before a network timeout. Retry only an explicitly failed
recipient through the audited broadcast operation after confirming the target
is eligible.

## CRM mock outbox and reconciliation

CRM mock operations use the same PostgreSQL-backed outbox principle. The worker
polls bounded due CRM records in `PENDING` or `RETRY`; a Redis outage cannot
discard a committed CRM intent because the record stays eligible for the next
worker scan. The mock adapter never receives or stores a real CRM credential.

Inspect the project CRM operation journal for `SUCCEEDED`, `RETRY`, `FAILED`,
or `UNKNOWN` state and safe error codes only. A failed operation may be retried
from the journal. An `UNKNOWN` operation requires explicit confirmation because
the provider might already have applied the request; confirm provider state
before requeueing it. The retry resets a new attempt group, is audited, and
never exposes request payload, credentials, or provider raw errors.

For a real CRM, use the reconciliation contract in
`docs/CRM_CONTRACT_REQUIRED.md`; never infer delivery from a timeout alone.
