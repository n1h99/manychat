-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN     "preparationLockedAt" TIMESTAMPTZ(3),
ADD COLUMN     "preparationLockedBy" TEXT;
