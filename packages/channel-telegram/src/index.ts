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
  download?(token: string, filePath: string, maximumBytes: number): Promise<Uint8Array>;
  upload?(
    token: string,
    method: string,
    fields: Record<string, unknown>,
    file: {
      bytes: Uint8Array;
      contentType: string;
      field: string;
      filename: string;
    },
  ): Promise<{
    ok: boolean;
    result?: unknown;
    errorCode?: number;
    parameters?: { retry_after?: number };
    description?: string;
  }>;
  uploadMany?(
    token: string,
    method: string,
    fields: Record<string, unknown>,
    files: Array<{
      bytes: Uint8Array;
      contentType: string;
      field: string;
      filename: string;
    }>,
  ): Promise<{
    ok: boolean;
    result?: unknown;
    errorCode?: number;
    parameters?: { retry_after?: number };
    description?: string;
  }>;
}
export interface TelegramMediaUpload {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}
export interface TelegramMediaGroupItem {
  caption?: string;
  captionEntities?: TelegramMessageEntity[];
  hasSpoiler?: boolean;
  kind: 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'VIDEO';
  media: string | TelegramMediaUpload;
}
export type TelegramMediaKind =
  'ANIMATION' | 'AUDIO' | 'DOCUMENT' | 'PHOTO' | 'STICKER' | 'VIDEO' | 'VIDEO_NOTE' | 'VOICE';

export interface TelegramInlineKeyboardButton {
  callbackData?: string;
  text: string;
  url?: string;
}

export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

export type TelegramChatAction =
  | 'choose_sticker'
  | 'find_location'
  | 'record_video'
  | 'record_video_note'
  | 'record_voice'
  | 'typing'
  | 'upload_document'
  | 'upload_photo'
  | 'upload_video'
  | 'upload_video_note'
  | 'upload_voice';

export interface TelegramMessageEntity {
  customEmojiId?: string;
  language?: string;
  length: number;
  offset: number;
  type:
    | 'blockquote'
    | 'bold'
    | 'bot_command'
    | 'code'
    | 'custom_emoji'
    | 'email'
    | 'expandable_blockquote'
    | 'hashtag'
    | 'italic'
    | 'mention'
    | 'phone_number'
    | 'pre'
    | 'spoiler'
    | 'strikethrough'
    | 'text_link'
    | 'underline'
    | 'url';
  url?: string;
}

export interface TelegramLinkPreviewOptions {
  isDisabled?: boolean;
  preferLargeMedia?: boolean;
  preferSmallMedia?: boolean;
  showAboveText?: boolean;
  url?: string;
}

export interface TelegramReplyOptions {
  messageId: string;
  quote?: string;
  quotePosition?: number;
}

export type TelegramReaction =
  { emoji: string; type: 'emoji' } | { customEmojiId: string; type: 'custom_emoji' };

const telegramEntityTypes = new Set<TelegramMessageEntity['type']>([
  'blockquote',
  'bold',
  'bot_command',
  'code',
  'custom_emoji',
  'email',
  'expandable_blockquote',
  'hashtag',
  'italic',
  'mention',
  'phone_number',
  'pre',
  'spoiler',
  'strikethrough',
  'text_link',
  'underline',
  'url',
]);

export function validateTelegramMessageEntities(
  input: unknown,
  text: string,
): TelegramMessageEntity[] {
  if (!Array.isArray(input) || input.length > 100) throw new Error('telegram_entities_invalid');
  return input.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      throw new Error('telegram_entity_invalid');
    const entity = candidate as Record<string, unknown>;
    if (
      typeof entity.type !== 'string' ||
      !telegramEntityTypes.has(entity.type as TelegramMessageEntity['type']) ||
      !Number.isSafeInteger(entity.offset) ||
      !Number.isSafeInteger(entity.length) ||
      (entity.offset as number) < 0 ||
      (entity.length as number) < 1 ||
      (entity.offset as number) + (entity.length as number) > text.length
    )
      throw new Error('telegram_entity_invalid');
    if (entity.url !== undefined && typeof entity.url !== 'string')
      throw new Error('telegram_entity_invalid');
    if (entity.customEmojiId !== undefined && typeof entity.customEmojiId !== 'string')
      throw new Error('telegram_entity_invalid');
    if (entity.language !== undefined && typeof entity.language !== 'string')
      throw new Error('telegram_entity_invalid');
    return {
      ...(typeof entity.customEmojiId === 'string' ? { customEmojiId: entity.customEmojiId } : {}),
      ...(typeof entity.language === 'string' ? { language: entity.language } : {}),
      length: entity.length as number,
      offset: entity.offset as number,
      type: entity.type as TelegramMessageEntity['type'],
      ...(typeof entity.url === 'string' ? { url: entity.url } : {}),
    };
  });
}

export function validateTelegramLinkPreviewOptions(input: unknown): TelegramLinkPreviewOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('telegram_link_preview_invalid');
  const options = input as Record<string, unknown>;
  for (const field of ['isDisabled', 'preferLargeMedia', 'preferSmallMedia', 'showAboveText'])
    if (options[field] !== undefined && typeof options[field] !== 'boolean')
      throw new Error('telegram_link_preview_invalid');
  if (options.url !== undefined) {
    if (typeof options.url !== 'string') throw new Error('telegram_link_preview_invalid');
    let parsed: URL;
    try {
      parsed = new URL(options.url);
    } catch {
      throw new Error('telegram_link_preview_invalid');
    }
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new Error('telegram_link_preview_invalid');
  }
  return {
    ...(typeof options.isDisabled === 'boolean' ? { isDisabled: options.isDisabled } : {}),
    ...(typeof options.preferLargeMedia === 'boolean'
      ? { preferLargeMedia: options.preferLargeMedia }
      : {}),
    ...(typeof options.preferSmallMedia === 'boolean'
      ? { preferSmallMedia: options.preferSmallMedia }
      : {}),
    ...(typeof options.showAboveText === 'boolean' ? { showAboveText: options.showAboveText } : {}),
    ...(typeof options.url === 'string' ? { url: options.url } : {}),
  };
}

export function validateTelegramInlineKeyboard(input: unknown): TelegramInlineKeyboard {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8)
    throw new Error('telegram_inline_keyboard_rows_invalid');
  return input.map((row) => {
    if (!Array.isArray(row) || row.length < 1 || row.length > 8)
      throw new Error('telegram_inline_keyboard_buttons_invalid');
    return row.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
        throw new Error('telegram_inline_keyboard_button_invalid');
      const button = candidate as Record<string, unknown>;
      if (typeof button.text !== 'string' || button.text.length < 1 || button.text.length > 64)
        throw new Error('telegram_inline_keyboard_text_invalid');
      const callbackData =
        typeof button.callbackData === 'string' ? button.callbackData : undefined;
      const url = typeof button.url === 'string' ? button.url : undefined;
      if ((callbackData ? 1 : 0) + (url ? 1 : 0) !== 1)
        throw new Error('telegram_inline_keyboard_action_invalid');
      if (
        callbackData !== undefined &&
        (Buffer.byteLength(callbackData, 'utf8') < 1 ||
          Buffer.byteLength(callbackData, 'utf8') > 64)
      )
        throw new Error('telegram_inline_keyboard_callback_invalid');
      if (url !== undefined) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error('telegram_inline_keyboard_url_invalid');
        }
        if (!['http:', 'https:', 'tg:'].includes(parsed.protocol))
          throw new Error('telegram_inline_keyboard_url_invalid');
      }
      return {
        ...(callbackData === undefined ? {} : { callbackData }),
        text: button.text,
        ...(url === undefined ? {} : { url }),
      };
    });
  });
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  message_reaction?: TelegramMessageReactionUpdated;
  callback_query?: { id: string; data?: string; from: TelegramUser; message?: TelegramMessage };
  my_chat_member?: {
    chat: { id: number; type: string };
    from: TelegramUser;
    new_chat_member: { status: string };
  };
  [key: string]: unknown;
}
export type TelegramInboundReaction =
  | { emoji: string; type: 'emoji' }
  | { customEmojiId: string; type: 'custom_emoji' }
  | { type: 'paid' };
export interface TelegramMessageReactionUpdated {
  actor_chat?: { id: number; title?: string; type: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  message_id: number;
  new_reaction: (
    | { custom_emoji_id: string; type: 'custom_emoji' }
    | { emoji: string; type: 'emoji' }
    | { type: 'paid' }
  )[];
  old_reaction: (
    | { custom_emoji_id: string; type: 'custom_emoji' }
    | { emoji: string; type: 'emoji' }
    | { type: 'paid' }
  )[];
  user?: TelegramUser;
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
  entities?: TelegramMessageEntityWire[];
  caption_entities?: TelegramMessageEntityWire[];
  edit_date?: number;
  has_media_spoiler?: boolean;
  media_group_id?: string;
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
  animation?: TelegramFileMedia & {
    duration: number;
    height: number;
    width: number;
  };
  sticker?: TelegramFileMedia & {
    emoji?: string;
    height: number;
    is_animated: boolean;
    is_video: boolean;
    set_name?: string;
    width: number;
  };
  audio?: TelegramFileMedia & {
    duration: number;
    performer?: string;
    title?: string;
  };
  video?: TelegramFileMedia & {
    duration: number;
    height: number;
    width: number;
  };
  video_note?: TelegramFileMedia & {
    duration: number;
    length: number;
  };
  voice?: TelegramFileMedia & {
    duration: number;
  };
  contact?: {
    phone_number: string;
    first_name: string;
    last_name?: string;
    user_id?: number;
    vcard?: string;
  };
}

interface TelegramMessageEntityWire {
  type: string;
  offset: number;
  length: number;
  url?: string;
  language?: string;
  custom_emoji_id?: string;
}

interface TelegramFileMedia {
  file_id: string;
  file_name?: string;
  file_size?: number;
  file_unique_id: string;
  mime_type?: string;
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
  async download(token: string, filePath: string, maximumBytes: number): Promise<Uint8Array> {
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!response.ok) throw new TelegramApiError(response.status, undefined);
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > maximumBytes) throw new Error('telegram_media_size_exceeded');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error('telegram_media_size_exceeded');
    return bytes;
  }

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
    return this.response(response);
  }

  async upload(
    token: string,
    method: string,
    fields: Record<string, unknown>,
    file: {
      bytes: Uint8Array;
      contentType: string;
      field: string;
      filename: string;
    },
  ): Promise<{
    ok: boolean;
    result?: unknown;
    errorCode?: number;
    parameters?: { retry_after?: number };
    description?: string;
  }> {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      form.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const bytes = new Uint8Array(file.bytes);
    form.append(file.field, new Blob([bytes.buffer], { type: file.contentType }), file.filename);
    return this.response(
      await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        body: form,
        method: 'POST',
      }),
    );
  }

  async uploadMany(
    token: string,
    method: string,
    fields: Record<string, unknown>,
    files: Array<{
      bytes: Uint8Array;
      contentType: string;
      field: string;
      filename: string;
    }>,
  ) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      form.append(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    for (const file of files) {
      const bytes = new Uint8Array(file.bytes);
      form.append(file.field, new Blob([bytes.buffer], { type: file.contentType }), file.filename);
    }
    return this.response(
      await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        body: form,
        method: 'POST',
      }),
    );
  }

  private async response(response: Response): Promise<{
    ok: boolean;
    result?: unknown;
    errorCode?: number;
    parameters?: { retry_after?: number };
    description?: string;
  }> {
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
  | 'ANIMATION'
  | 'AUDIO'
  | 'CALLBACK_QUERY'
  | 'CHAT_MEMBER'
  | 'COMMAND'
  | 'CONTACT_SHARED'
  | 'DOCUMENT'
  | 'MESSAGE'
  | 'PHOTO'
  | 'REACTION'
  | 'MESSAGE_EDITED'
  | 'STICKER'
  | 'UNSUPPORTED'
  | 'VIDEO'
  | 'VIDEO_NOTE'
  | 'VOICE';

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

function mediaPresentation(message: TelegramMessage): Record<string, unknown> {
  return {
    ...(message.has_media_spoiler === undefined ? {} : { hasSpoiler: message.has_media_spoiler }),
    ...(message.media_group_id ? { mediaGroupId: message.media_group_id } : {}),
  };
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
  if (message.contact) {
    return {
      ...base,
      content: {
        firstName: message.contact.first_name,
        ...(message.contact.last_name ? { lastName: message.contact.last_name } : {}),
        phoneNumber: message.contact.phone_number,
        ...(message.contact.user_id === undefined
          ? {}
          : { telegramUserId: String(message.contact.user_id) }),
        ...(message.contact.vcard ? { vcard: message.contact.vcard } : {}),
      },
      type: 'CONTACT_SHARED',
    };
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
        ...mediaPresentation(message),
        width: photo.width,
      },
      type: 'PHOTO',
    };
  }
  // Telegram also sets `document` for animations for backward compatibility.
  // Prefer the more specific field so GIF/MP4 animations keep their semantics.
  if (message.animation) {
    return {
      ...base,
      content: {
        caption: message.caption ?? null,
        duration: message.animation.duration,
        fileId: message.animation.file_id,
        fileName: message.animation.file_name ?? null,
        fileSize: message.animation.file_size ?? null,
        fileUniqueId: message.animation.file_unique_id,
        height: message.animation.height,
        ...mediaPresentation(message),
        mimeType: message.animation.mime_type ?? null,
        width: message.animation.width,
      },
      type: 'ANIMATION',
    };
  }
  if (message.sticker) {
    return {
      ...base,
      content: {
        emoji: message.sticker.emoji ?? null,
        fileId: message.sticker.file_id,
        fileName: message.sticker.file_name ?? null,
        fileSize: message.sticker.file_size ?? null,
        fileUniqueId: message.sticker.file_unique_id,
        height: message.sticker.height,
        isAnimated: message.sticker.is_animated,
        isVideo: message.sticker.is_video,
        mimeType: message.sticker.mime_type ?? null,
        setName: message.sticker.set_name ?? null,
        width: message.sticker.width,
      },
      type: 'STICKER',
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
        ...mediaPresentation(message),
        mimeType: message.document.mime_type ?? null,
      },
      type: 'DOCUMENT',
    };
  }
  const media = (
    [
      ['video', 'VIDEO'],
      ['audio', 'AUDIO'],
      ['voice', 'VOICE'],
      ['video_note', 'VIDEO_NOTE'],
    ] as const
  ).find(([field]) => message[field] !== undefined);
  if (media) {
    const [field, type] = media;
    const value = message[field]!;
    return {
      ...base,
      content: {
        caption: message.caption ?? null,
        duration: value.duration,
        fileId: value.file_id,
        fileName: value.file_name ?? null,
        fileSize: value.file_size ?? null,
        fileUniqueId: value.file_unique_id,
        mimeType: value.mime_type ?? null,
        ...mediaPresentation(message),
        ...('height' in value ? { height: value.height } : {}),
        ...('length' in value ? { length: value.length } : {}),
        ...('performer' in value ? { performer: value.performer ?? null } : {}),
        ...('title' in value ? { title: value.title ?? null } : {}),
        ...('width' in value ? { width: value.width } : {}),
      },
      type,
    };
  }
  return { ...base, content: {}, type: 'UNSUPPORTED' };
}

function normalizedEntities(input: TelegramMessageEntityWire[] | undefined) {
  return input?.map((entity) => ({
    ...(entity.custom_emoji_id ? { customEmojiId: entity.custom_emoji_id } : {}),
    ...(entity.language ? { language: entity.language } : {}),
    length: entity.length,
    offset: entity.offset,
    type: entity.type,
    ...(entity.url ? { url: entity.url } : {}),
  }));
}

function editedMessageEvent(message: TelegramMessage): TelegramInboundEvent {
  const content = {
    targetExternalMessageId: String(message.message_id),
    ...(message.text === undefined ? {} : { text: message.text }),
    ...(message.text === undefined ? { caption: message.caption ?? '' } : {}),
    entities: normalizedEntities(message.entities ?? message.caption_entities) ?? [],
    occurredAt: new Date((message.edit_date ?? message.date ?? 0) * 1_000).toISOString(),
  };
  return {
    chatId: String(message.chat.id),
    content,
    externalMessageId: String(message.message_id),
    ...(message.from ? { externalUserId: String(message.from.id), user: message.from } : {}),
    metadata: { source: 'telegram' },
    type: 'MESSAGE_EDITED',
  };
}

function inboundReactions(
  reactions: TelegramMessageReactionUpdated['new_reaction'],
): TelegramInboundReaction[] {
  return reactions.map((reaction) => {
    if (reaction.type === 'emoji' && typeof reaction.emoji === 'string')
      return { emoji: reaction.emoji, type: 'emoji' };
    if (reaction.type === 'custom_emoji' && typeof reaction.custom_emoji_id === 'string')
      return { customEmojiId: reaction.custom_emoji_id, type: 'custom_emoji' };
    if (reaction.type === 'paid') return { type: 'paid' };
    throw new Error('Telegram update is malformed');
  });
}

export function normalizeTelegramUpdate(update: TelegramUpdate): TelegramInboundEvent {
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) {
    throw new Error('Telegram update is malformed');
  }
  if (update.message) return messageEvent(update.message);
  if (update.edited_message) return editedMessageEvent(update.edited_message);
  if (update.message_reaction) {
    const reaction = update.message_reaction;
    if (
      !Number.isSafeInteger(reaction.chat?.id) ||
      !Number.isSafeInteger(reaction.message_id) ||
      !Number.isSafeInteger(reaction.date) ||
      !Array.isArray(reaction.old_reaction) ||
      !Array.isArray(reaction.new_reaction)
    )
      throw new Error('Telegram update is malformed');
    const actor = reaction.user
      ? {
          displayName: [reaction.user.first_name, reaction.user.last_name]
            .filter(Boolean)
            .join(' '),
          externalUserId: String(reaction.user.id),
          type: 'user',
          ...(reaction.user.username ? { username: reaction.user.username } : {}),
        }
      : reaction.actor_chat
        ? {
            displayName:
              reaction.actor_chat.title ?? reaction.actor_chat.username ?? 'Telegram chat',
            externalChatId: String(reaction.actor_chat.id),
            type: 'chat',
            ...(reaction.actor_chat.username ? { username: reaction.actor_chat.username } : {}),
          }
        : undefined;
    if (reaction.chat.type !== 'private' || !reaction.user || !actor)
      return {
        content: {
          reasonCode: 'REACTION_CHAT_SCOPE_NOT_SUPPORTED',
          targetExternalMessageId: String(reaction.message_id),
        },
        metadata: { telegramMessageReaction: reaction },
        type: 'UNSUPPORTED',
      };
    return {
      chatId: String(reaction.chat.id),
      content: {
        actor,
        newReactions: inboundReactions(reaction.new_reaction),
        occurredAt: new Date(reaction.date * 1_000).toISOString(),
        oldReactions: inboundReactions(reaction.old_reaction),
        targetExternalMessageId: String(reaction.message_id),
      },
      externalUserId: String(reaction.user.id),
      metadata: { telegramMessageReaction: reaction },
      type: 'REACTION',
      user: reaction.user,
    };
  }
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
    broadcasts: true,
    deliveryStatuses: false,
    incoming: {
      animationMetadata: true,
      audioMetadata: true,
      callbackQuery: true,
      contact: true,
      documentMetadata: true,
      editedMessage: true,
      myChatMember: true,
      photoMetadata: true,
      reaction: true,
      stickerMetadata: true,
      text: true,
      unsupported: true,
      videoMetadata: true,
      videoNoteMetadata: true,
      voiceMetadata: true,
    },
    outgoing: {
      animation: true,
      audio: true,
      chatActions: true,
      deleteMessage: true,
      disableNotification: true,
      editMessage: true,
      formattingEntities: true,
      inlineKeyboard: true,
      linkPreviewOptions: true,
      messageEffects: true,
      mediaSpoiler: true,
      pinMessage: true,
      protectContent: true,
      reactions: true,
      replyToMessageId: true,
      streamingDraft: true,
      sticker: true,
      text: true,
      photo: true,
      document: true,
      video: true,
      videoNote: true,
      voice: true,
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
        allowed_updates: [
          'message',
          'edited_message',
          'callback_query',
          'my_chat_member',
          'message_reaction',
        ],
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
      entities?: TelegramMessageEntity[];
      inlineKeyboard?: TelegramInlineKeyboard;
      linkPreviewOptions?: TelegramLinkPreviewOptions;
      messageEffectId?: string;
      protectContent?: boolean;
      reply?: TelegramReplyOptions;
      replyToMessageId?: string;
      text: string;
    },
  ): Promise<{ messageId: string }> {
    const response = await this.transport.request(token, 'sendMessage', {
      chat_id: input.chatId,
      disable_notification: input.disableNotification,
      ...(input.entities ? { entities: this.telegramEntities(input.entities) } : {}),
      ...(input.inlineKeyboard
        ? { reply_markup: { inline_keyboard: this.telegramKeyboard(input.inlineKeyboard) } }
        : {}),
      ...(input.linkPreviewOptions
        ? { link_preview_options: this.telegramLinkPreview(input.linkPreviewOptions) }
        : {}),
      ...(input.messageEffectId ? { message_effect_id: input.messageEffectId } : {}),
      ...(input.protectContent === undefined ? {} : { protect_content: input.protectContent }),
      ...((input.reply ??
      (input.replyToMessageId ? { messageId: input.replyToMessageId } : undefined))
        ? {
            reply_parameters: this.telegramReply(
              input.reply ?? { messageId: input.replyToMessageId! },
            ),
          }
        : {}),
      text: input.text,
    });
    await this.assertOk(response);
    const result = response.result as { message_id?: number };
    if (!result.message_id) throw new Error('Telegram sendMessage result is invalid');
    return { messageId: String(result.message_id) };
  }
  async downloadFile(
    token: string,
    fileId: string,
    maximumBytes: number,
  ): Promise<{ bytes: Uint8Array; filePath: string }> {
    const response = await this.transport.request(token, 'getFile', { file_id: fileId });
    await this.assertOk(response);
    const result = response.result as { file_path?: unknown; file_size?: unknown };
    if (typeof result.file_path !== 'string') throw new Error('Telegram getFile result is invalid');
    if (typeof result.file_size === 'number' && result.file_size > maximumBytes)
      throw new Error('telegram_media_size_exceeded');
    if (!this.transport.download)
      throw new Error('Telegram file download transport is unavailable');
    return {
      bytes: await this.transport.download(token, result.file_path, maximumBytes),
      filePath: result.file_path,
    };
  }
  async sendMedia(
    token: string,
    input: {
      caption?: string;
      captionEntities?: TelegramMessageEntity[];
      chatId: string;
      disableNotification?: boolean;
      inlineKeyboard?: TelegramInlineKeyboard;
      kind: TelegramMediaKind;
      media: string | TelegramMediaUpload;
      hasSpoiler?: boolean;
      protectContent?: boolean;
      reply?: TelegramReplyOptions;
      replyToMessageId?: string;
    },
  ): Promise<{ messageId: string }> {
    const mediaMethods: Record<TelegramMediaKind, { field: string; method: string }> = {
      ANIMATION: { field: 'animation', method: 'sendAnimation' },
      AUDIO: { field: 'audio', method: 'sendAudio' },
      DOCUMENT: { field: 'document', method: 'sendDocument' },
      PHOTO: { field: 'photo', method: 'sendPhoto' },
      STICKER: { field: 'sticker', method: 'sendSticker' },
      VIDEO: { field: 'video', method: 'sendVideo' },
      VIDEO_NOTE: { field: 'video_note', method: 'sendVideoNote' },
      VOICE: { field: 'voice', method: 'sendVoice' },
    };
    if (input.hasSpoiler && !['ANIMATION', 'PHOTO', 'VIDEO'].includes(input.kind))
      throw new Error('telegram_media_spoiler_not_supported');
    const selected = mediaMethods[input.kind];
    const fields = {
      chat_id: input.chatId,
      disable_notification: input.disableNotification,
      ...(input.protectContent === undefined ? {} : { protect_content: input.protectContent }),
      ...(input.hasSpoiler ? { has_spoiler: true } : {}),
      ...(['STICKER', 'VIDEO_NOTE'].includes(input.kind) || input.caption === undefined
        ? {}
        : { caption: input.caption }),
      ...(['STICKER', 'VIDEO_NOTE'].includes(input.kind) || !input.captionEntities
        ? {}
        : { caption_entities: this.telegramEntities(input.captionEntities) }),
      ...(input.inlineKeyboard
        ? { reply_markup: { inline_keyboard: this.telegramKeyboard(input.inlineKeyboard) } }
        : {}),
      ...((input.reply ??
      (input.replyToMessageId ? { messageId: input.replyToMessageId } : undefined))
        ? {
            reply_parameters: this.telegramReply(
              input.reply ?? { messageId: input.replyToMessageId! },
            ),
          }
        : {}),
    };
    const response =
      typeof input.media === 'string'
        ? await this.transport.request(token, selected.method, {
            ...fields,
            [selected.field]: input.media,
          })
        : await this.uploadMedia(token, selected.method, selected.field, fields, input.media);
    await this.assertOk(response);
    const result = response.result as { message_id?: number };
    if (!result.message_id) throw new Error(`Telegram ${selected.method} result is invalid`);
    return { messageId: String(result.message_id) };
  }
  async sendMediaGroup(
    token: string,
    input: {
      chatId: string;
      disableNotification?: boolean;
      items: TelegramMediaGroupItem[];
      protectContent?: boolean;
    },
  ): Promise<{ messageIds: string[] }> {
    if (input.items.length < 2 || input.items.length > 10)
      throw new Error('telegram_media_group_size_invalid');
    const kinds = new Set(input.items.map((item) => item.kind));
    if (
      (kinds.has('AUDIO') && kinds.size !== 1) ||
      (kinds.has('DOCUMENT') && kinds.size !== 1) ||
      [...kinds].some((kind) => !['AUDIO', 'DOCUMENT', 'PHOTO', 'VIDEO'].includes(kind))
    )
      throw new Error('telegram_media_group_kind_invalid');
    const files: Array<{
      bytes: Uint8Array;
      contentType: string;
      field: string;
      filename: string;
    }> = [];
    const media = input.items.map((item, index) => {
      const type = item.kind.toLowerCase();
      const reference =
        typeof item.media === 'string'
          ? item.media
          : (() => {
              const field = `media_${index}`;
              files.push({ ...item.media, field });
              return `attach://${field}`;
            })();
      return {
        ...(item.caption === undefined ? {} : { caption: item.caption }),
        ...(item.captionEntities
          ? { caption_entities: this.telegramEntities(item.captionEntities) }
          : {}),
        ...(item.hasSpoiler ? { has_spoiler: true } : {}),
        media: reference,
        type,
      };
    });
    const fields = {
      chat_id: input.chatId,
      disable_notification: input.disableNotification,
      media,
      protect_content: input.protectContent,
    };
    const response = files.length
      ? await this.transport.uploadMany?.(token, 'sendMediaGroup', fields, files)
      : await this.transport.request(token, 'sendMediaGroup', fields);
    if (!response) throw new Error('Telegram media group upload transport is unavailable');
    await this.assertOk(response);
    if (!Array.isArray(response.result))
      throw new Error('Telegram sendMediaGroup result is invalid');
    const messageIds = response.result.map((item) =>
      item &&
      typeof item === 'object' &&
      Number.isSafeInteger((item as { message_id?: unknown }).message_id)
        ? String((item as { message_id: number }).message_id)
        : '',
    );
    if (messageIds.length !== input.items.length || messageIds.some((id) => !id))
      throw new Error('Telegram sendMediaGroup result is invalid');
    return { messageIds };
  }
  async sendStructuredMessage(
    token: string,
    input: {
      chatId: string;
      disableNotification?: boolean;
      protectContent?: boolean;
      structured:
        | {
            firstName: string;
            lastName?: string;
            phoneNumber: string;
            type: 'contact';
            vcard?: string;
          }
        | {
            horizontalAccuracy?: number;
            latitude: number;
            longitude: number;
            type: 'location';
          }
        | {
            allowsMultipleAnswers?: boolean;
            isAnonymous?: boolean;
            options: string[];
            question: string;
            type: 'poll';
          };
    },
  ): Promise<{ messageId: string }> {
    const common = {
      chat_id: input.chatId,
      disable_notification: input.disableNotification,
      protect_content: input.protectContent,
    };
    const structured = input.structured;
    const response =
      structured.type === 'contact'
        ? await this.transport.request(token, 'sendContact', {
            ...common,
            first_name: structured.firstName,
            last_name: structured.lastName,
            phone_number: structured.phoneNumber,
            vcard: structured.vcard,
          })
        : structured.type === 'location'
          ? await this.transport.request(token, 'sendLocation', {
              ...common,
              horizontal_accuracy: structured.horizontalAccuracy,
              latitude: structured.latitude,
              longitude: structured.longitude,
            })
          : await this.transport.request(token, 'sendPoll', {
              ...common,
              allows_multiple_answers: structured.allowsMultipleAnswers,
              is_anonymous: structured.isAnonymous,
              options: structured.options.map((text) => ({ text })),
              question: structured.question,
            });
    await this.assertOk(response);
    const result = response.result as { message_id?: number };
    if (!result.message_id) throw new Error('Telegram structured message result is invalid');
    return { messageId: String(result.message_id) };
  }
  async answerCallbackQuery(
    token: string,
    input: { callbackQueryId: string; showAlert?: boolean; text?: string },
  ): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, 'answerCallbackQuery', {
        callback_query_id: input.callbackQueryId,
        ...(input.showAlert === undefined ? {} : { show_alert: input.showAlert }),
        ...(input.text === undefined ? {} : { text: input.text }),
      }),
    );
  }
  async sendChatAction(
    token: string,
    input: { action: TelegramChatAction; chatId: string },
  ): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, 'sendChatAction', {
        action: input.action,
        chat_id: input.chatId,
      }),
    );
  }
  async setMessageReaction(
    token: string,
    input: { chatId: string; isBig?: boolean; messageId: string; reaction?: TelegramReaction },
  ): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, 'setMessageReaction', {
        chat_id: input.chatId,
        is_big: input.isBig,
        message_id: Number(input.messageId),
        reaction: input.reaction ? [this.telegramReaction(input.reaction)] : [],
      }),
    );
  }
  async editMessageText(
    token: string,
    input: {
      chatId: string;
      entities?: TelegramMessageEntity[];
      inlineKeyboard?: TelegramInlineKeyboard;
      linkPreviewOptions?: TelegramLinkPreviewOptions;
      messageId: string;
      text: string;
    },
  ): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, 'editMessageText', {
        chat_id: input.chatId,
        ...(input.entities ? { entities: this.telegramEntities(input.entities) } : {}),
        ...(input.inlineKeyboard
          ? { reply_markup: { inline_keyboard: this.telegramKeyboard(input.inlineKeyboard) } }
          : {}),
        ...(input.linkPreviewOptions
          ? { link_preview_options: this.telegramLinkPreview(input.linkPreviewOptions) }
          : {}),
        message_id: Number(input.messageId),
        text: input.text,
      }),
    );
  }
  async editMessageCaption(
    token: string,
    input: {
      caption: string;
      chatId: string;
      entities?: TelegramMessageEntity[];
      inlineKeyboard?: TelegramInlineKeyboard;
      messageId: string;
    },
  ): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, 'editMessageCaption', {
        caption: input.caption,
        caption_entities: input.entities ? this.telegramEntities(input.entities) : undefined,
        chat_id: input.chatId,
        ...(input.inlineKeyboard
          ? { reply_markup: { inline_keyboard: this.telegramKeyboard(input.inlineKeyboard) } }
          : {}),
        message_id: Number(input.messageId),
      }),
    );
  }
  async deleteMessage(token: string, input: { chatId: string; messageId: string }): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, 'deleteMessage', {
        chat_id: input.chatId,
        message_id: Number(input.messageId),
      }),
    );
  }
  async setMessagePinned(
    token: string,
    input: { chatId: string; disableNotification?: boolean; messageId: string; pinned: boolean },
  ): Promise<void> {
    await this.assertOk(
      await this.transport.request(token, input.pinned ? 'pinChatMessage' : 'unpinChatMessage', {
        chat_id: input.chatId,
        ...(input.pinned ? { disable_notification: input.disableNotification } : {}),
        message_id: Number(input.messageId),
      }),
    );
  }
  async sendMessageDraft(
    token: string,
    input: {
      chatId: string;
      draftId: number;
      entities?: TelegramMessageEntity[];
      text?: string;
    },
  ): Promise<void> {
    if (!Number.isSafeInteger(input.draftId) || input.draftId === 0)
      throw new Error('telegram_draft_id_invalid');
    if (!input.text) return;
    await this.assertOk(
      await this.transport.request(token, 'sendMessageDraft', {
        chat_id: input.chatId,
        draft_id: input.draftId,
        ...(input.entities ? { entities: this.telegramEntities(input.entities) } : {}),
        text: input.text,
      }),
    );
  }
  async configureBotInterface(
    token: string,
    input: {
      commands: Array<{ command: string; description: string }>;
      languageCode?: string;
      menuButton: { text?: string; type: 'commands' | 'default' | 'web_app'; url?: string };
      scope: { chatId?: string; type: 'all_private_chats' | 'chat' | 'default' };
    },
  ): Promise<void> {
    const scope =
      input.scope.type === 'chat'
        ? { chat_id: Number(input.scope.chatId), type: 'chat' }
        : { type: input.scope.type };
    await this.assertOk(
      await this.transport.request(token, 'setMyCommands', {
        commands: input.commands,
        language_code: input.languageCode ?? '',
        scope,
      }),
    );
    const menuButton =
      input.menuButton.type === 'web_app'
        ? {
            text: input.menuButton.text,
            type: 'web_app',
            web_app: { url: input.menuButton.url },
          }
        : { type: input.menuButton.type };
    await this.assertOk(
      await this.transport.request(token, 'setChatMenuButton', {
        ...(input.scope.type === 'chat' ? { chat_id: Number(input.scope.chatId) } : {}),
        menu_button: menuButton,
      }),
    );
  }
  private async uploadMedia(
    token: string,
    method: string,
    mediaField: string,
    fields: Record<string, unknown>,
    media: TelegramMediaUpload,
  ) {
    if (!this.transport.upload) throw new Error('Telegram media upload transport is unavailable');
    return this.transport.upload(token, method, fields, {
      ...media,
      field: mediaField,
    });
  }
  private telegramKeyboard(keyboard: TelegramInlineKeyboard) {
    return validateTelegramInlineKeyboard(keyboard).map((row) =>
      row.map((button) => ({
        ...(button.callbackData === undefined ? {} : { callback_data: button.callbackData }),
        text: button.text,
        ...(button.url === undefined ? {} : { url: button.url }),
      })),
    );
  }
  private telegramEntities(entities: TelegramMessageEntity[]) {
    return entities.map((entity) => ({
      ...(entity.customEmojiId ? { custom_emoji_id: entity.customEmojiId } : {}),
      ...(entity.language ? { language: entity.language } : {}),
      length: entity.length,
      offset: entity.offset,
      type: entity.type,
      ...(entity.url ? { url: entity.url } : {}),
    }));
  }
  private telegramLinkPreview(options: TelegramLinkPreviewOptions) {
    return {
      ...(options.isDisabled === undefined ? {} : { is_disabled: options.isDisabled }),
      ...(options.preferLargeMedia === undefined
        ? {}
        : { prefer_large_media: options.preferLargeMedia }),
      ...(options.preferSmallMedia === undefined
        ? {}
        : { prefer_small_media: options.preferSmallMedia }),
      ...(options.showAboveText === undefined ? {} : { show_above_text: options.showAboveText }),
      ...(options.url ? { url: options.url } : {}),
    };
  }
  private telegramReaction(reaction: TelegramReaction) {
    return reaction.type === 'emoji'
      ? { emoji: reaction.emoji, type: 'emoji' }
      : { custom_emoji_id: reaction.customEmojiId, type: 'custom_emoji' };
  }
  private telegramReply(reply: TelegramReplyOptions) {
    return {
      message_id: Number(reply.messageId),
      ...(reply.quote ? { quote: reply.quote } : {}),
      ...(reply.quotePosition === undefined ? {} : { quote_position: reply.quotePosition }),
    };
  }
  parseWebhook(update: TelegramUpdate): TelegramNormalizedEvent {
    if (update.message)
      return {
        ...(update.message.from ? { externalUserId: String(update.message.from.id) } : {}),
        kind: 'message',
        payload: update.message as unknown as Record<string, unknown>,
      };
    if (update.edited_message)
      return {
        ...(update.edited_message.from
          ? { externalUserId: String(update.edited_message.from.id) }
          : {}),
        kind: 'message',
        payload: update.edited_message as unknown as Record<string, unknown>,
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
