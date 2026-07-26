import { telegramInboundFixtures } from '@omnicus/test-fixtures';
import { describe, expect, it } from 'vitest';

import { normalizeTelegramUpdate } from './index';

describe('normalizeTelegramUpdate', () => {
  it('preserves command text and separates command arguments', () => {
    const event = normalizeTelegramUpdate({
      ...telegramInboundFixtures.text.payload,
      message: { ...telegramInboundFixtures.text.payload.message, text: '/start one two' },
    });

    expect(event).toMatchObject({
      content: { arguments: ['one', 'two'], command: 'start', text: '/start one two' },
      type: 'COMMAND',
    });
  });

  it('keeps only Telegram media metadata and selects the largest photo resolution', () => {
    expect(normalizeTelegramUpdate(telegramInboundFixtures.photo.payload)).toMatchObject({
      content: {
        fileId: 'large-file-id',
        fileUniqueId: 'large-unique-id',
        height: 900,
        width: 900,
      },
      type: 'PHOTO',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.document.payload)).toMatchObject({
      content: {
        fileId: 'document-file-id',
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
      },
      type: 'DOCUMENT',
    });
  });

  it('normalizes callbacks, member availability, and unknown updates without throwing', () => {
    expect(normalizeTelegramUpdate(telegramInboundFixtures.callbackQuery.payload)).toMatchObject({
      externalMessageId: 'callback:callback-1',
      type: 'CALLBACK_QUERY',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.blocked.payload)).toMatchObject({
      identityStatus: 'BLOCKED',
      type: 'CHAT_MEMBER',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.unblocked.payload)).toMatchObject({
      identityStatus: 'ACTIVE',
      type: 'CHAT_MEMBER',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.unsupported.payload)).toMatchObject({
      type: 'UNSUPPORTED',
    });
  });
});
