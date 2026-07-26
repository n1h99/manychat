# Operations runbook — Stage 0 skeleton

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

## Telegram inbound enqueue failure

A valid Telegram webhook first commits `RawWebhookEvent` and a pending
`InboxRecord` to PostgreSQL. The subsequent BullMQ enqueue is best-effort. If
Redis is unavailable, Telegram still receives HTTP 200 and the pending inbox
record remains the source-of-truth recovery candidate. Do not replay the
provider request body or manually alter the raw event. Stage 3B.3b will add the
recovery scheduler that re-enqueues pending records using their stable inbox ID.

## Telegram inbound processor lease

Stage 3B.3a workers consume only the stable `inboxRecordId` from BullMQ and
load the raw event from PostgreSQL. A worker atomically claims `PENDING` or
`RETRY` work, records its lock owner/time and increments attempts. A current
`PROCESSING` lease must not be manually cleared; an expired lease may be
reclaimed by a later job. Successful processing completes the record in the
same transaction as normalized-event, contact/identity, conversation, and
message persistence. Safe processing errors release the record as `RETRY`.
The periodic re-enqueue/recovery scheduler and dead-letter procedure remain
Stage 3B.3b work.
