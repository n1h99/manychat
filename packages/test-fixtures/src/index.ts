export interface SafeFixture<TPayload> {
  name: string;
  payload: TPayload;
  source: 'synthetic';
}

export function defineSafeFixture<TPayload>(
  name: string,
  payload: TPayload,
): SafeFixture<TPayload> {
  return {
    name,
    payload,
    source: 'synthetic',
  };
}

const telegramUser = {
  first_name: 'Ada',
  id: 1001,
  language_code: 'en',
  last_name: 'Lovelace',
  username: 'ada',
};

export const telegramInboundFixtures = {
  blocked: defineSafeFixture('telegram-blocked', {
    my_chat_member: {
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      new_chat_member: { status: 'kicked' },
    },
    update_id: 106,
  }),
  callbackQuery: defineSafeFixture('telegram-callback-query', {
    callback_query: {
      data: 'confirm',
      from: telegramUser,
      id: 'callback-1',
      message: { chat: { id: 1001, type: 'private' }, from: telegramUser, message_id: 55 },
    },
    update_id: 105,
  }),
  document: defineSafeFixture('telegram-document', {
    message: {
      caption: 'contract',
      chat: { id: 1001, type: 'private' },
      document: {
        file_id: 'document-file-id',
        file_name: 'contract.pdf',
        file_size: 1024,
        file_unique_id: 'document-unique-id',
        mime_type: 'application/pdf',
      },
      from: telegramUser,
      message_id: 12,
    },
    update_id: 103,
  }),
  malformed: defineSafeFixture('telegram-malformed', { message: {}, update_id: 'invalid' }),
  photo: defineSafeFixture('telegram-photo', {
    message: {
      caption: 'photo caption',
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      message_id: 11,
      photo: [
        { file_id: 'small-file-id', file_unique_id: 'small-unique-id', height: 90, width: 90 },
        {
          file_id: 'large-file-id',
          file_size: 2048,
          file_unique_id: 'large-unique-id',
          height: 900,
          width: 900,
        },
      ],
    },
    update_id: 102,
  }),
  text: defineSafeFixture('telegram-text', {
    message: {
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      message_id: 10,
      text: 'hello',
    },
    update_id: 101,
  }),
  unblocked: defineSafeFixture('telegram-unblocked', {
    my_chat_member: {
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      new_chat_member: { status: 'member' },
    },
    update_id: 107,
  }),
  unsupported: defineSafeFixture('telegram-unsupported', {
    update_id: 108,
    user_shared: { request_id: 1 },
  }),
} as const;
