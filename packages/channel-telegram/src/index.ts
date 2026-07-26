import type { ChannelAdapterDescriptor } from '@omnicus/channel-core';

export interface TelegramTransport {
  request(
    token: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    result?: unknown;
    errorCode?: number;
    parameters?: { retry_after?: number };
    description?: string;
  }>;
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: { id: string; data?: string; from: TelegramUser; message?: TelegramMessage };
  my_chat_member?: {
    chat: { id: number };
    from: TelegramUser;
    new_chat_member: { status: string };
  };
  [key: string]: unknown;
}
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}
export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  photo?: {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
}
export interface TelegramNormalizedEvent {
  externalUserId?: string;
  kind: 'callback_query' | 'message' | 'my_chat_member' | 'unsupported';
  payload: Record<string, unknown>;
}
export const telegramDescriptor: ChannelAdapterDescriptor = {
  channel: 'telegram',
  version: 'bot-api-10.2',
  capabilities: {
    broadcasts: false,
    deliveryStatuses: false,
    incoming: {
      callbackQuery: true,
      documentMetadata: true,
      myChatMember: true,
      photoMetadata: true,
      text: true,
      unsupported: true,
    },
    outgoing: {
      disableNotification: true,
      inlineKeyboard: true,
      replyToMessageId: true,
      text: true,
    },
    readStatuses: false,
  },
};
export class TelegramAdapter {
  constructor(private readonly transport: TelegramTransport) {}
  async validateConnection(token: string): Promise<{ id: string; username?: string }> {
    const response = await this.transport.request(token, 'getMe');
    if (!response.ok || !this.isBot(response.result))
      throw new Error('Telegram connection validation failed');
    return {
      id: String(response.result.id),
      ...(response.result.username ? { username: response.result.username } : {}),
    };
  }
  async configureWebhook(
    token: string,
    input: { secretToken: string; url: string },
  ): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, 'setWebhook', {
        allowed_updates: ['message', 'callback_query', 'my_chat_member'],
        secret_token: input.secretToken,
        url: input.url,
      }),
    );
  }
  async removeWebhook(token: string): Promise<void> {
    await this.assertOk(await this.transport.request(token, 'deleteWebhook'));
  }
  async sendMessage(
    token: string,
    input: {
      chatId: string;
      disableNotification?: boolean;
      inlineKeyboard?: unknown;
      replyToMessageId?: string;
      text: string;
    },
  ): Promise<{ messageId: string }> {
    const response = await this.transport.request(token, 'sendMessage', {
      chat_id: input.chatId,
      disable_notification: input.disableNotification,
      ...(input.inlineKeyboard ? { reply_markup: { inline_keyboard: input.inlineKeyboard } } : {}),
      ...(input.replyToMessageId
        ? { reply_parameters: { message_id: Number(input.replyToMessageId) } }
        : {}),
      text: input.text,
    });
    await this.assertOk(response);
    const result = response.result as { message_id?: number };
    if (!result.message_id) throw new Error('Telegram sendMessage result is invalid');
    return { messageId: String(result.message_id) };
  }
  parseWebhook(update: TelegramUpdate): TelegramNormalizedEvent {
    if (update.message)
      return {
        ...(update.message.from ? { externalUserId: String(update.message.from.id) } : {}),
        kind: 'message',
        payload: update.message as unknown as Record<string, unknown>,
      };
    if (update.callback_query)
      return {
        externalUserId: String(update.callback_query.from.id),
        kind: 'callback_query',
        payload: update.callback_query as unknown as Record<string, unknown>,
      };
    if (update.my_chat_member)
      return {
        externalUserId: String(update.my_chat_member.from.id),
        kind: 'my_chat_member',
        payload: update.my_chat_member as unknown as Record<string, unknown>,
      };
    return { kind: 'unsupported', payload: update as Record<string, unknown> };
  }
  private isBot(value: unknown): value is { id: number; username?: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { id?: unknown }).id === 'number'
    );
  }
  private async assertOk(response: { ok: boolean; description?: string }): Promise<void> {
    if (!response.ok) throw new Error(response.description ?? 'Telegram API request failed');
  }
}
