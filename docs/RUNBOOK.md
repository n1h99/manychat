# Operations runbook — Stage 3B.3b

## One-time production administrator bootstrap

The development/test seed remains blocked inside Railway and must never be
enabled by changing `APP_ENV` on a production database. A new empty Railway
database is initialized through the dedicated `pnpm db:bootstrap:admin`
command after migrations have succeeded.

The command requires all of the following API service variables:

- `ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true`;
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`,
  `BOOTSTRAP_ADMIN_FIRST_NAME`, and `BOOTSTRAP_ADMIN_LAST_NAME`;
- `BOOTSTRAP_DATABASE_NAME_CONFIRMATION`, exactly matching the database name in
  `DATABASE_URL`;
- `BOOTSTRAP_RAILWAY_PROJECT_NAME_CONFIRMATION`, exactly matching Railway's
  `RAILWAY_PROJECT_NAME`.

The password must contain at least 16 characters. The command is restricted to
an identified Railway service, takes a PostgreSQL advisory transaction lock,
refuses to elevate an existing unassigned user, creates the permissions,
system `Super Admin` role, user, assignment, and audit record atomically, and
does not reset the password when an already initialized matching administrator
is encountered.

For the one bootstrap deployment only, set the API pre-deploy command to:

```text
pnpm db:migrate:deploy && pnpm db:bootstrap:admin
```

After the successful deployment, immediately remove every `BOOTSTRAP_*`
variable and `ALLOW_PRODUCTION_ADMIN_BOOTSTRAP`, then restore the permanent
pre-deploy command to `pnpm db:migrate:deploy`. The administrative bootstrap
files are stripped from API and worker runtime artifacts.

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

## Browser session reloads

Production browser API traffic uses the web service's same-origin `/api` proxy.
`VITE_API_URL` remains the server-side upstream target and must resolve to the
public API origin. A successful login sets the opaque refresh cookie on the web
origin through the proxy; the access JWT remains only in browser memory and is
restored by refresh bootstrap after a reload.

If a reload unexpectedly returns to login, verify that the deployed web
artifact contains `runtime-config.json`, that `/api/v1/auth/refresh` is proxied
by the web service, and that the login response sets `omnicus_refresh` for the
web origin. Do not move access or refresh tokens to browser storage as a
workaround.

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

`API_PUBLIC_URL` must be the exact public HTTPS origin of the API service.
Channel connect derives `/webhooks/telegram/<connectionId>` from this
server-owned value and never accepts a client-provided webhook base URL.

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

## Telegram media and template assets

`MediaAsset` is the lifecycle source of truth. Inbound Telegram photo/document
events initially store only `file_id`, safe metadata and
`PROVIDER_REFERENCE`; an operator materializes the object only when a template
or durable asset needs it. The API calls `getFile`, enforces the 20 MB
application limit, checks magic bytes, MIME and extension, and only then writes
to the private S3-compatible bucket. Provider and bucket credentials must never
be copied into an incident, database query output or browser state.

`AVAILABLE` objects receive signed URLs only on demand. URLs are short-lived and
must not be persisted. The worker scans bounded expired assets according to
`MEDIA_RETENTION_INTERVAL_MS` and `MEDIA_RETENTION_BATCH_SIZE`; assets referenced
by `PUBLISHED` or `SUPERSEDED` template versions are retained. A bucket outage
does not delete the PostgreSQL record: failed upload/materialization/delete
operations remain visible through safe lifecycle status and can be retried
after storage recovery.

Staging and production require `MEDIA_STORAGE_ENABLED=true` plus
`MEDIA_BUCKET`, `MEDIA_BUCKET_ENDPOINT`, `MEDIA_BUCKET_REGION`,
`MEDIA_BUCKET_ACCESS_KEY_ID`, and `MEDIA_BUCKET_SECRET_ACCESS_KEY`. The endpoint
must be HTTPS outside local development. Railway Bucket is authenticated object
storage, not a private network; this runbook does not assume native lifecycle,
versioning or server-side encryption features.
