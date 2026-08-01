import { describe, expect, it, vi } from 'vitest';

import { TelegramAdapter, type TelegramTransport } from './index';

function transport() {
  return {
    download: vi.fn(async () => Uint8Array.from([1, 2, 3])),
    request: vi.fn(),
    upload: vi.fn(),
  } satisfies TelegramTransport;
}

describe('Telegram media adapter', () => {
  it('downloads only after getFile and enforces the configured boundary', async () => {
    const mock = transport();
    mock.request.mockResolvedValue({
      ok: true,
      result: { file_path: 'documents/file.pdf', file_size: 3 },
    });
    const adapter = new TelegramAdapter(mock);

    await expect(adapter.downloadFile('redacted-token', 'file-id', 10)).resolves.toEqual({
      bytes: Uint8Array.from([1, 2, 3]),
      filePath: 'documents/file.pdf',
    });
    expect(mock.request).toHaveBeenCalledWith('redacted-token', 'getFile', {
      file_id: 'file-id',
    });
    expect(mock.download).toHaveBeenCalledWith('redacted-token', 'documents/file.pdf', 10);
  });

  it('does not download a provider file declared above the limit', async () => {
    const mock = transport();
    mock.request.mockResolvedValue({
      ok: true,
      result: { file_path: 'documents/file.pdf', file_size: 11 },
    });

    await expect(new TelegramAdapter(mock).downloadFile('token', 'file-id', 10)).rejects.toThrow(
      'telegram_media_size_exceeded',
    );
    expect(mock.download).not.toHaveBeenCalled();
  });

  it.each([
    ['PHOTO', 'sendPhoto', 'photo'],
    ['DOCUMENT', 'sendDocument', 'document'],
    ['VIDEO', 'sendVideo', 'video'],
    ['AUDIO', 'sendAudio', 'audio'],
    ['VOICE', 'sendVoice', 'voice'],
    ['VIDEO_NOTE', 'sendVideoNote', 'video_note'],
    ['ANIMATION', 'sendAnimation', 'animation'],
    ['STICKER', 'sendSticker', 'sticker'],
  ] as const)('sends %s using the matching Telegram method', async (kind, method, field) => {
    const mock = transport();
    mock.request.mockResolvedValue({ ok: true, result: { message_id: 42 } });

    await expect(
      new TelegramAdapter(mock).sendMedia('token', {
        caption: 'Caption',
        chatId: '100',
        kind,
        media: 'provider-file-id',
      }),
    ).resolves.toEqual({ messageId: '42' });
    expect(mock.request).toHaveBeenCalledWith(
      'token',
      method,
      expect.objectContaining({ [field]: 'provider-file-id', chat_id: '100' }),
    );
  });

  it('does not send captions for stickers and forwards supported media spoilers', async () => {
    const mock = transport();
    mock.request.mockResolvedValue({ ok: true, result: { message_id: 45 } });
    const adapter = new TelegramAdapter(mock);

    await adapter.sendMedia('token', {
      caption: 'must not be sent',
      chatId: '100',
      kind: 'STICKER',
      media: 'sticker-file-id',
    });
    expect(mock.request).toHaveBeenLastCalledWith('token', 'sendSticker', {
      chat_id: '100',
      disable_notification: undefined,
      sticker: 'sticker-file-id',
    });

    await adapter.sendMedia('token', {
      chatId: '100',
      hasSpoiler: true,
      kind: 'PHOTO',
      media: 'photo-file-id',
    });
    expect(mock.request).toHaveBeenLastCalledWith(
      'token',
      'sendPhoto',
      expect.objectContaining({ has_spoiler: true, photo: 'photo-file-id' }),
    );
  });

  it('rejects spoilers for unsupported media before calling Telegram', async () => {
    const mock = transport();

    await expect(
      new TelegramAdapter(mock).sendMedia('token', {
        chatId: '100',
        hasSpoiler: true,
        kind: 'DOCUMENT',
        media: 'document-file-id',
      }),
    ).rejects.toThrow('telegram_media_spoiler_not_supported');
    expect(mock.request).not.toHaveBeenCalled();
  });

  it('uses Telegram reply parameters and validates inline callback buttons', async () => {
    const mock = transport();
    mock.request.mockResolvedValue({ ok: true, result: { message_id: 44 } });

    await new TelegramAdapter(mock).sendMessage('token', {
      chatId: '100',
      inlineKeyboard: [[{ callbackData: 'budget:1000', text: 'До 1000' }]],
      replyToMessageId: '42',
      text: 'Выберите бюджет',
    });

    expect(mock.request).toHaveBeenCalledWith(
      'token',
      'sendMessage',
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{ callback_data: 'budget:1000', text: 'До 1000' }]],
        },
        reply_parameters: { message_id: 42 },
      }),
    );
  });

  it('acknowledges callback queries through the official method', async () => {
    const mock = transport();
    mock.request.mockResolvedValue({ ok: true, result: true });

    await new TelegramAdapter(mock).answerCallbackQuery('token', {
      callbackQueryId: 'callback-1',
    });

    expect(mock.request).toHaveBeenCalledWith('token', 'answerCallbackQuery', {
      callback_query_id: 'callback-1',
    });
  });

  it('uploads private bucket media directly instead of exposing a signed URL', async () => {
    const mock = transport();
    mock.upload.mockResolvedValue({ ok: true, result: { message_id: 43 } });

    await expect(
      new TelegramAdapter(mock).sendMedia('token', {
        caption: 'Private photo',
        chatId: '100',
        kind: 'PHOTO',
        media: {
          bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
          contentType: 'image/jpeg',
          filename: 'photo.jpg',
        },
      }),
    ).resolves.toEqual({ messageId: '43' });
    expect(mock.upload).toHaveBeenCalledWith(
      'token',
      'sendPhoto',
      expect.objectContaining({ caption: 'Private photo', chat_id: '100' }),
      expect.objectContaining({
        contentType: 'image/jpeg',
        field: 'photo',
        filename: 'photo.jpg',
      }),
    );
    expect(mock.request).not.toHaveBeenCalled();
  });
});
