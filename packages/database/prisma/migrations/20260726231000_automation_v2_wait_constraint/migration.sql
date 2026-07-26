-- Prisma cannot express this partial uniqueness constraint. It protects the
-- reply/timeout race and makes one active wait per conversation/scenario a
-- database invariant instead of an application-only convention.
CREATE UNIQUE INDEX "wait_states_one_active_per_conversation_scenario"
ON "wait_states" ("projectId", "conversationId", "scenarioId")
WHERE "status" = 'ACTIVE';
