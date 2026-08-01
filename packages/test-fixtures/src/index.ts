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
  animation: defineSafeFixture('telegram-animation', {
    message: {
      animation: {
        duration: 3,
        file_id: 'animation-file-id',
        file_name: 'welcome.gif',
        file_size: 2048,
        file_unique_id: 'animation-unique-id',
        height: 320,
        mime_type: 'image/gif',
        width: 320,
      },
      caption: 'welcome',
      chat: { id: 1001, type: 'private' },
      document: {
        file_id: 'animation-file-id',
        file_name: 'welcome.gif',
        file_size: 2048,
        file_unique_id: 'animation-unique-id',
        mime_type: 'image/gif',
      },
      from: telegramUser,
      message_id: 17,
    },
    update_id: 113,
  }),
  audio: defineSafeFixture('telegram-audio', {
    message: {
      audio: {
        duration: 42,
        file_id: 'audio-file-id',
        file_name: 'track.mp3',
        file_size: 4096,
        file_unique_id: 'audio-unique-id',
        mime_type: 'audio/mpeg',
        performer: 'Omnicus',
        title: 'Welcome',
      },
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      message_id: 14,
    },
    update_id: 110,
  }),
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
      has_media_spoiler: true,
      media_group_id: 'album-1',
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
  reaction: defineSafeFixture('telegram-reaction', {
    message_reaction: {
      chat: { id: 1001, type: 'private' },
      date: 1_785_535_200,
      message_id: 42,
      new_reaction: [{ emoji: '👍', type: 'emoji' }],
      old_reaction: [],
      user: telegramUser,
    },
    update_id: 114,
  }),
  sticker: defineSafeFixture('telegram-sticker', {
    message: {
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      message_id: 17,
      sticker: {
        emoji: '👋',
        file_id: 'sticker-file-id',
        file_size: 4096,
        file_unique_id: 'sticker-unique-id',
        height: 512,
        is_animated: false,
        is_video: false,
        mime_type: 'image/webp',
        set_name: 'omnicus_demo',
        width: 512,
      },
    },
    update_id: 115,
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
  video: defineSafeFixture('telegram-video', {
    message: {
      caption: 'demo',
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      message_id: 13,
      video: {
        duration: 8,
        file_id: 'video-file-id',
        file_name: 'demo.mp4',
        file_size: 8192,
        file_unique_id: 'video-unique-id',
        height: 720,
        mime_type: 'video/mp4',
        width: 1280,
      },
    },
    update_id: 109,
  }),
  videoNote: defineSafeFixture('telegram-video-note', {
    message: {
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      message_id: 16,
      video_note: {
        duration: 10,
        file_id: 'video-note-file-id',
        file_size: 4096,
        file_unique_id: 'video-note-unique-id',
        length: 384,
      },
    },
    update_id: 112,
  }),
  voice: defineSafeFixture('telegram-voice', {
    message: {
      chat: { id: 1001, type: 'private' },
      from: telegramUser,
      message_id: 15,
      voice: {
        duration: 7,
        file_id: 'voice-file-id',
        file_size: 1024,
        file_unique_id: 'voice-unique-id',
        mime_type: 'audio/ogg',
      },
    },
    update_id: 111,
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
