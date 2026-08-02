import { telegramInboundFixtures } from '@omnicus/test-fixtures';
import { describe, expect, it } from 'vitest';

import { normalizeTelegramUpdate, type TelegramUpdate } from './index';

describe('normalizeTelegramUpdate', () => {
  it('normalizes edited_message as a source-linked event instead of a second message', () => {
    const event = normalizeTelegramUpdate({
      update_id: 901,
      edited_message: {
        chat: { id: 123, type: 'private' },
        date: 1_754_000_000,
        edit_date: 1_754_000_100,
        entities: [{ length: 6, offset: 0, type: 'bold' }],
        from: { first_name: 'Ada', id: 123 },
        message_id: 42,
        text: 'Edited',
      },
    });

    expect(event).toMatchObject({
      content: {
        entities: [{ length: 6, offset: 0, type: 'bold' }],
        targetExternalMessageId: '42',
        text: 'Edited',
      },
      externalUserId: '123',
      type: 'MESSAGE_EDITED',
    });
    expect(event.metadata).toEqual({ source: 'telegram' });
  });

  it('normalizes a shared contact without inferring a contact merge', () => {
    expect(
      normalizeTelegramUpdate({
        update_id: 902,
        message: {
          chat: { id: 123, type: 'private' },
          contact: {
            first_name: 'Grace',
            last_name: 'Hopper',
            phone_number: '+12025550123',
            user_id: 456,
          },
          from: { first_name: 'Ada', id: 123 },
          message_id: 43,
        },
      }),
    ).toMatchObject({
      content: {
        firstName: 'Grace',
        lastName: 'Hopper',
        phoneNumber: '+12025550123',
        telegramUserId: '456',
      },
      type: 'CONTACT_SHARED',
    });
  });
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

  it('normalizes an inbound reply target without exposing provider structure to consumers', () => {
    const event = normalizeTelegramUpdate({
      ...telegramInboundFixtures.text.payload,
      message: {
        ...telegramInboundFixtures.text.payload.message,
        message_id: 44,
        reply_to_message: { message_id: 42 },
        text: 'Reply',
      },
    });

    expect(event).toMatchObject({
      externalMessageId: '44',
      metadata: { replyToExternalMessageId: '42' },
      type: 'MESSAGE',
    });
  });

  it('keeps only Telegram media metadata and selects the largest photo resolution', () => {
    expect(normalizeTelegramUpdate(telegramInboundFixtures.photo.payload)).toMatchObject({
      content: {
        fileId: 'large-file-id',
        fileUniqueId: 'large-unique-id',
        hasSpoiler: true,
        height: 900,
        mediaGroupId: 'album-1',
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
    expect(normalizeTelegramUpdate(telegramInboundFixtures.video.payload)).toMatchObject({
      content: { fileId: 'video-file-id', height: 720, width: 1280 },
      type: 'VIDEO',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.audio.payload)).toMatchObject({
      content: { fileId: 'audio-file-id', performer: 'Omnicus', title: 'Welcome' },
      type: 'AUDIO',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.voice.payload)).toMatchObject({
      content: { fileId: 'voice-file-id', mimeType: 'audio/ogg' },
      type: 'VOICE',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.videoNote.payload)).toMatchObject({
      content: { fileId: 'video-note-file-id', length: 384 },
      type: 'VIDEO_NOTE',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.animation.payload)).toMatchObject({
      content: { fileId: 'animation-file-id', fileName: 'welcome.gif' },
      type: 'ANIMATION',
    });
    expect(normalizeTelegramUpdate(telegramInboundFixtures.sticker.payload)).toMatchObject({
      content: {
        emoji: '👋',
        fileId: 'sticker-file-id',
        fileUniqueId: 'sticker-unique-id',
        isAnimated: false,
        isVideo: false,
        setName: 'omnicus_demo',
      },
      type: 'STICKER',
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

  it('normalizes a private-chat user reaction with a stable provider target', () => {
    expect(
      normalizeTelegramUpdate(telegramInboundFixtures.reaction.payload as TelegramUpdate),
    ).toMatchObject({
      chatId: '1001',
      content: {
        actor: { externalUserId: '1001', type: 'user' },
        newReactions: [{ emoji: '👍', type: 'emoji' }],
        oldReactions: [],
        targetExternalMessageId: '42',
      },
      externalUserId: '1001',
      type: 'REACTION',
    });
  });
});
