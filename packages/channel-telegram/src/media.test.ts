import { describe, expect, it, vi } from 'vitest';

import { TelegramAdapter, type TelegramTransport } from './index';

function transport() {
  return {
    download: vi.fn(async () => Uint8Array.from([1, 2, 3])),
    request: vi.fn(),
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
});
