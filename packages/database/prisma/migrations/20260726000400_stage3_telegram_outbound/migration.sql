-- Stage 3C.1: explicit retry state for transactional Telegram outbox records.
-- PostgreSQL remains the source of truth; BullMQ only executes/re-enqueues records.
ALTER TYPE "OutboxRecordStatus" ADD VALUE 'RETRY';
