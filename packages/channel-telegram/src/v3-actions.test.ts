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
  });
});
