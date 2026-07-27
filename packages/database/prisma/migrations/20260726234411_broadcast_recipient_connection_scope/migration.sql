/*
  Warnings:

  - You are about to drop the column `channelConnectionId` on the `broadcast_recipients` table. All the data in the column will be lost.
  - Added the required column `connectionId` to the `broadcast_recipients` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "broadcast_recipients" DROP CONSTRAINT "broadcast_recipients_channelConnectionId_fkey";

-- AlterTable
ALTER TABLE "broadcast_recipients" DROP COLUMN "channelConnectionId",
ADD COLUMN     "connectionId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "broadcast_recipients_projectId_connectionId_status_idx" ON "broadcast_recipients"("projectId", "connectionId", "status");

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_projectId_connectionId_fkey" FOREIGN KEY ("projectId", "connectionId") REFERENCES "channel_connections"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
