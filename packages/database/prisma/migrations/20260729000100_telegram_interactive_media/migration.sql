-- AlterEnum
ALTER TYPE "NormalizedEventType" ADD VALUE 'VIDEO';
ALTER TYPE "NormalizedEventType" ADD VALUE 'AUDIO';
ALTER TYPE "NormalizedEventType" ADD VALUE 'VOICE';
ALTER TYPE "NormalizedEventType" ADD VALUE 'VIDEO_NOTE';
ALTER TYPE "NormalizedEventType" ADD VALUE 'ANIMATION';

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'VIDEO';
ALTER TYPE "MessageType" ADD VALUE 'AUDIO';
ALTER TYPE "MessageType" ADD VALUE 'VOICE';
ALTER TYPE "MessageType" ADD VALUE 'VIDEO_NOTE';
ALTER TYPE "MessageType" ADD VALUE 'ANIMATION';

-- AlterEnum
ALTER TYPE "MessageTemplateKind" ADD VALUE 'VIDEO';
ALTER TYPE "MessageTemplateKind" ADD VALUE 'AUDIO';
ALTER TYPE "MessageTemplateKind" ADD VALUE 'VOICE';
ALTER TYPE "MessageTemplateKind" ADD VALUE 'VIDEO_NOTE';
ALTER TYPE "MessageTemplateKind" ADD VALUE 'ANIMATION';
