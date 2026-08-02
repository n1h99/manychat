import { describe, expect, it, vi } from 'vitest';

import { TelegramAdapter, type TelegramTransport } from './index';

function adapter() {
  const request = vi.fn().mockResolvedValue({ ok: true, result: { message_id: 42 } });
  return {
    adapter: new TelegramAdapter({ request } as TelegramTransport),
    request,
  };
}

describe('Telegram v3 adapter actions', () => {
  it('subscribes the webhook to user reaction updates', async () => {
    const fixture = adapter();

    await fixture.adapter.configureWebhook('secret', {
      secretToken: 'webhook-secret',
      url: 'https://example.test/webhooks/telegram/connection-a',
    });

    expect(fixture.request).toHaveBeenCalledWith(
      'secret',
      'setWebhook',
      expect.objectContaining({
        allowed_updates: expect.arrayContaining(['message_reaction']),
      }),
    );
  });

  it('maps rich text, quote and presentation options to Bot API fields', async () => {
    const fixture = adapter();
    await fixture.adapter.sendMessage('secret', {
      chatId: '123',
      entities: [{ length: 4, offset: 0, type: 'bold' }],
      linkPreviewOptions: { isDisabled: true },
      messageEffectId: 'effect-a',
      protectContent: true,
      reply: { messageId: '9', quote: 'test', quotePosition: 2 },
      text: 'test',
    });

    expect(fixture.request).toHaveBeenCalledWith(
      'secret',
      'sendMessage',
      expect.objectContaining({
        entities: [{ length: 4, offset: 0, type: 'bold' }],
        link_preview_options: { is_disabled: true },
        message_effect_id: 'effect-a',
        protect_content: true,
        reply_parameters: { message_id: 9, quote: 'test', quote_position: 2 },
      }),
    );
  });

  it('maps reaction, chat action, pin and delete without leaking provider data', async () => {
    const fixture = adapter();
    await fixture.adapter.setMessageReaction('secret', {
      chatId: '123',
      messageId: '42',
      reaction: { emoji: '👍', type: 'emoji' },
    });
    await fixture.adapter.sendChatAction('secret', { action: 'typing', chatId: '123' });
    await fixture.adapter.setMessagePinned('secret', {
      chatId: '123',
      messageId: '42',
      pinned: true,
    });
    await fixture.adapter.deleteMessage('secret', { chatId: '123', messageId: '42' });

    expect(fixture.request.mock.calls.map((call) => call[1])).toEqual([
      'setMessageReaction',
      'sendChatAction',
      'pinChatMessage',
      'deleteMessage',
    ]);
  });

  it('uses a stable non-zero draft id and never persists a draft as a message', async () => {
    const fixture = adapter();
    await fixture.adapter.sendMessageDraft('secret', {
      chatId: '123',
      draftId: 7,
      text: 'partial',
    });
    expect(fixture.request).toHaveBeenCalledWith('secret', 'sendMessageDraft', {
      chat_id: '123',
      draft_id: 7,
      text: 'partial',
    });
    await expect(
      fixture.adapter.sendMessageDraft('secret', { chatId: '123', draftId: 0 }),
    ).rejects.toThrow('telegram_draft_id_invalid');
    fixture.request.mockClear();
    await fixture.adapter.sendMessageDraft('secret', { chatId: '123', draftId: 8, text: '' });
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it('sends a media group as one provider operation and preserves item order', async () => {
    const fixture = adapter();
    fixture.request.mockResolvedValueOnce({
      ok: true,
      result: [{ message_id: 41 }, { message_id: 42 }],
    });

    await expect(
      fixture.adapter.sendMediaGroup('secret', {
        chatId: '123',
        items: [
          { caption: 'First', kind: 'PHOTO', media: 'file-photo-a' },
          { hasSpoiler: true, kind: 'VIDEO', media: 'file-video-a' },
        ],
      }),
    ).resolves.toEqual({ messageIds: ['41', '42'] });

    expect(fixture.request).toHaveBeenCalledWith(
      'secret',
      'sendMediaGroup',
      expect.objectContaining({
        media: [
          expect.objectContaining({ caption: 'First', media: 'file-photo-a', type: 'photo' }),
          expect.objectContaining({ has_spoiler: true, media: 'file-video-a', type: 'video' }),
        ],
      }),
    );
  });

  it('configures scoped commands and menu without accepting a provider chat id from CRM', async () => {
    const fixture = adapter();
    await fixture.adapter.configureBotInterface('secret', {
      commands: [{ command: 'help', description: 'Show help' }],
      menuButton: { type: 'commands' },
      scope: { chatId: '123', type: 'chat' },
    });

    expect(fixture.request.mock.calls.map((call) => call[1])).toEqual([
      'setMyCommands',
      'setChatMenuButton',
    ]);
    expect(fixture.request).toHaveBeenNthCalledWith(
      1,
      'secret',
      'setMyCommands',
      expect.objectContaining({ scope: { chat_id: 123, type: 'chat' } }),
    );
  });

  it('maps normalized contact, location and poll requests to dedicated Bot API methods', async () => {
    const fixture = adapter();
    await fixture.adapter.sendStructuredMessage('secret', {
      chatId: '123',
      structured: { firstName: 'Ada', phoneNumber: '+12025550123', type: 'contact' },
    });
    await fixture.adapter.sendStructuredMessage('secret', {
      chatId: '123',
      structured: { latitude: 40.4, longitude: 49.8, type: 'location' },
    });
    await fixture.adapter.sendStructuredMessage('secret', {
      chatId: '123',
      structured: { options: ['A', 'B'], question: 'Choose', type: 'poll' },
    });

    expect(fixture.request.mock.calls.map((call) => call[1])).toEqual([
      'sendContact',
      'sendLocation',
      'sendPoll',
    ]);
  });
});
