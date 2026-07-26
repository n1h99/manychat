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
    chat: { id: number; type: string };
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
  date?: number;
  text?: string;
  caption?: string;
  photo?: {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }[];
  document?: {
    file_id: string;
    file_name?: string;
    file_size?: number;
    file_unique_id: string;
    mime_type?: string;
  };
}
export interface TelegramNormalizedEvent {
  externalUserId?: string;
  kind: 'callback_query' | 'message' | 'my_chat_member' | 'unsupported';
  payload: Record<string, unknown>;
}

export const TELEGRAM_INBOUND_QUEUE_NAME = 'telegram-inbound';
export const TELEGRAM_INBOUND_JOB_NAME = 'process-inbox-record';
export const TELEGRAM_OUTBOUND_QUEUE_NAME = 'telegram-outbound';
export const TELEGRAM_OUTBOUND_JOB_NAME = 'deliver-outbox-record';

export interface TelegramInboundJob {
  inboxRecordId: string;
}

export function telegramInboundJobIdFor(inboxRecordId: string): string {
  return `telegram-inbound-${inboxRecordId}`;
}

export interface TelegramOutboundJob {
  outboxRecordId: string;
}

export function telegramOutboundJobIdFor(outboxRecordId: string): string {
  return `telegram-outbound-${outboxRecordId}`;
}

export class TelegramApiError extends Error {
  constructor(
    readonly errorCode: number | undefined,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super('Telegram API request failed');
    this.name = 'TelegramApiError';
  }
}

export class TelegramHttpTransport implements TelegramTransport {
  async request(
    token: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    result?: unknown;
    errorCode?: number;
    parameters?: { retry_after?: number };
    description?: string;
  }> {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      ...(body === undefined
        ? { method: 'GET' }
        : {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (typeof payload !== 'object' || payload === null) return { ok: false };
    const result = payload as {
      description?: unknown;
      error_code?: unknown;
      ok?: unknown;
      parameters?: { retry_after?: unknown };
      result?: unknown;
    };
    return {
      ok: result.ok === true,
      result: result.result,
      ...(typeof result.description === 'string' ? { description: result.description } : {}),
      ...(typeof result.error_code === 'number' ? { errorCode: result.error_code } : {}),
      ...(typeof result.parameters?.retry_after === 'number'
        ? { parameters: { retry_after: result.parameters.retry_after } }
        : {}),
    };
  }
}

export type TelegramInboundEventType =
  'CALLBACK_QUERY' | 'CHAT_MEMBER' | 'COMMAND' | 'DOCUMENT' | 'MESSAGE' | 'PHOTO' | 'UNSUPPORTED';

export interface TelegramInboundEvent {
  chatId?: string;
  content: Record<string, unknown>;
  externalMessageId?: string;
  externalUserId?: string;
  identityStatus?: 'ACTIVE' | 'BLOCKED';
  metadata: Record<string, unknown>;
  type: TelegramInboundEventType;
  user?: TelegramUser;
}

function commandParts(text: string): { arguments: string[]; command: string } | undefined {
  const match = /^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/.exec(text);
  if (!match) return undefined;
  const command = match[1];
  if (!command) return undefined;
  return { arguments: match[2]?.split(/\s+/).filter(Boolean) ?? [], command };
}

function selectedPhoto(
  photos: NonNullable<TelegramMessage['photo']>,
): NonNullable<TelegramMessage['photo']>[number] {
  return [...photos].sort(
    (left, right) =>
      right.width * right.height - left.width * left.height ||
      (right.file_size ?? 0) - (left.file_size ?? 0),
  )[0]!;
}

function messageEvent(message: TelegramMessage): TelegramInboundEvent {
  const metadata = { telegramMessage: message };
  const base = {
    chatId: String(message.chat.id),
    externalMessageId: String(message.message_id),
    metadata,
    ...(message.from ? { externalUserId: String(message.from.id), user: message.from } : {}),
  };

  if (message.text !== undefined) {
    const command = commandParts(message.text);
    return command
      ? {
          ...base,
          content: { arguments: command.arguments, command: command.command, text: message.text },
          type: 'COMMAND',
        }
      : { ...base, content: { text: message.text }, type: 'MESSAGE' };
  }
  if (message.photo && message.photo.length > 0) {
    const photo = selectedPhoto(message.photo);
    return {
      ...base,
      content: {
        caption: message.caption ?? null,
        fileId: photo.file_id,
        fileSize: photo.file_size ?? null,
        fileUniqueId: photo.file_unique_id,
        height: photo.height,
        width: photo.width,
      },
      type: 'PHOTO',
    };
  }
  if (message.document) {
    return {
      ...base,
      content: {
        caption: message.caption ?? null,
        fileId: message.document.file_id,
        fileName: message.document.file_name ?? null,
        fileSize: message.document.file_size ?? null,
        fileUniqueId: message.document.file_unique_id,
        mimeType: message.document.mime_type ?? null,
      },
      type: 'DOCUMENT',
    };
  }
  return { ...base, content: {}, type: 'UNSUPPORTED' };
}

export function normalizeTelegramUpdate(update: TelegramUpdate): TelegramInboundEvent {
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) {
    throw new Error('Telegram update is malformed');
  }
  if (update.message) return messageEvent(update.message);
  if (update.callback_query) {
    return {
      ...(update.callback_query.message
        ? {
            chatId: String(update.callback_query.message.chat.id),
            externalMessageId: `callback:${update.callback_query.id}`,
          }
        : {}),
      content: { data: update.callback_query.data ?? null, id: update.callback_query.id },
      externalUserId: String(update.callback_query.from.id),
      metadata: { telegramCallbackQuery: update.callback_query },
      type: 'CALLBACK_QUERY',
      user: update.callback_query.from,
    };
  }
  if (update.my_chat_member) {
    const status = update.my_chat_member.new_chat_member.status;
    const identityStatus =
      status === 'kicked' ? 'BLOCKED' : status === 'member' ? 'ACTIVE' : undefined;
    return {
      chatId: String(update.my_chat_member.chat.id),
      content: { status },
      // A private chat's ID is the stable identity subject. Group events are not
      // assigned to a contact unless Telegram provides a resolvable user scope.
      metadata: { telegramChatMember: update.my_chat_member },
      type: 'CHAT_MEMBER',
      ...(update.my_chat_member.chat.type === 'private'
        ? {
            externalUserId: String(update.my_chat_member.chat.id),
            ...(identityStatus ? { identityStatus } : {}),
            user: update.my_chat_member.from,
          }
        : {}),
    };
  }
  return { content: {}, metadata: { telegramUpdate: update }, type: 'UNSUPPORTED' };
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
  private async assertOk(response: {
    description?: string;
    errorCode?: number;
    ok: boolean;
    parameters?: { retry_after?: number };
  }): Promise<void> {
    if (!response.ok)
      throw new TelegramApiError(response.errorCode, response.parameters?.retry_after);
  }
}
