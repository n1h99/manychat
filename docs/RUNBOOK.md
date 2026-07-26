# Operations runbook — Stage 3B.3b

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
`telegram-inbound:<inboxRecordId>` job ID makes concurrent workers safe. An
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
