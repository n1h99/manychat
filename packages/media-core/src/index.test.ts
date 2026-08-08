import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  MediaValidationError,
  prepareMediaForTelegram,
  prepareMediaForWhatsApp,
  renderMessageTemplateContent,
  renderTemplate,
  validateMedia,
} from './index';

describe('media validation', () => {
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
  };

  const jpeg = (width: number, height: number) =>
    Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      (height >> 8) & 0xff,
      height & 0xff,
      (width >> 8) & 0xff,
      width & 0xff,
      0x01,
      0x01,
      0x11,
      0x00,
    ]);

  const webp = (width: number, height: number) => {
    const bytes = new Uint8Array(30);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x56, 0x50, 0x38, 0x58], 12);
    const storedWidth = width - 1;
    const storedHeight = height - 1;
    bytes.set([storedWidth & 0xff, (storedWidth >> 8) & 0xff, (storedWidth >> 16) & 0xff], 24);
    bytes.set([storedHeight & 0xff, (storedHeight >> 8) & 0xff, (storedHeight >> 16) & 0xff], 27);
    return bytes;
  };

  it('accepts a matching JPEG photo', () => {
    expect(
      validateMedia({
        bytes: jpeg(800, 600),
        declaredMimeType: 'image/jpeg',
        filename: 'photo.jpg',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toMatchObject({
      extension: 'jpg',
      height: 600,
      mimeType: 'image/jpeg',
      sizeBytes: 15,
      width: 800,
    });
  });

  it('rejects mismatched declared media', () => {
    expect(() =>
      validateMedia({
        bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
        declaredMimeType: 'image/jpeg',
        filename: 'payload.jpg',
        kind: 'DOCUMENT',
        maximumBytes: 100,
      }),
    ).toThrow(MediaValidationError);
  });

  it('rejects oversized files and disguised extensions', () => {
    expect(() =>
      validateMedia({
        bytes: jpeg(800, 600),
        filename: 'photo.pdf',
        kind: 'PHOTO',
        maximumBytes: 3,
      }),
    ).toThrow(MediaValidationError);
    expect(() =>
      validateMedia({
        bytes: jpeg(800, 600),
        filename: 'photo.pdf',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toThrow(MediaValidationError);
  });

  it('accepts Telegram photo dimensions at the aspect-ratio boundary', () => {
    expect(
      validateMedia({
        bytes: png(1_420, 71),
        declaredMimeType: 'image/png',
        filename: 'banner.png',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toMatchObject({ height: 71, width: 1_420 });
  });

  it('rejects a photo whose aspect ratio exceeds the Telegram limit', () => {
    expect(() =>
      validateMedia({
        bytes: png(1_420, 64),
        declaredMimeType: 'image/png',
        filename: 'too-wide.png',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toThrow(expect.objectContaining({ code: 'media_photo_dimensions_rejected' }));
  });

  it('rejects a photo whose dimensions sum exceeds the Telegram limit', () => {
    expect(() =>
      validateMedia({
        bytes: png(6_000, 5_000),
        declaredMimeType: 'image/png',
        filename: 'too-large.png',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toThrow(expect.objectContaining({ code: 'media_photo_dimensions_rejected' }));
  });

  it('rejects a truncated photo without readable dimensions', () => {
    expect(() =>
      validateMedia({
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
        declaredMimeType: 'image/png',
        filename: 'truncated.png',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toThrow(expect.objectContaining({ code: 'media_photo_dimensions_unreadable' }));
  });

  it('pads an excessively wide photo without cropping its content', async () => {
    const source = await sharp({
      create: {
        background: { b: 40, g: 30, r: 20 },
        channels: 3,
        height: 64,
        width: 1_420,
      },
    })
      .png()
      .toBuffer();
    const prepared = await prepareMediaForTelegram({
      bytes: source,
      declaredMimeType: 'image/png',
      filename: 'wide-banner.png',
      kind: 'PHOTO',
      maximumBytes: 20 * 1024 * 1024,
    });

    expect(prepared).toMatchObject({
      extension: 'jpg',
      height: 71,
      mimeType: 'image/jpeg',
      transformed: true,
      width: 1_420,
    });
    await expect(sharp(prepared.bytes).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      height: 71,
      width: 1_420,
    });
  });

  it('scales down images whose dimension sum exceeds the Telegram limit', async () => {
    const source = await sharp({
      create: {
        background: { b: 40, g: 30, r: 20 },
        channels: 3,
        height: 5_500,
        width: 5_500,
      },
    })
      .jpeg()
      .toBuffer();
    const prepared = await prepareMediaForTelegram({
      bytes: source,
      declaredMimeType: 'image/jpeg',
      filename: 'large.jpg',
      kind: 'PHOTO',
      maximumBytes: 20 * 1024 * 1024,
    });

    expect(prepared.width! + prepared.height!).toBeLessThanOrEqual(10_000);
    expect(prepared.sizeBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
  }, 15_000);

  it('rejects corrupt image data during normalization', async () => {
    await expect(
      prepareMediaForTelegram({
        bytes: png(800, 600),
        declaredMimeType: 'image/png',
        filename: 'corrupt.png',
        kind: 'PHOTO',
        maximumBytes: 20 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'media_photo_decode_failed' });
  });

  it('requires both RIFF and WEBP markers for WebP files', () => {
    const riff = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
    expect(() =>
      validateMedia({
        bytes: riff,
        filename: 'video.webp',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toThrow(MediaValidationError);
  });

  it.each([
    ['static', 'sticker.webp', 'image/webp', webp(512, 384)],
    [
      'animated',
      'sticker.tgs',
      'application/x-tgsticker',
      Uint8Array.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0]),
    ],
    ['video', 'sticker.webm', 'video/webm', Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])],
  ] as const)('accepts a signature-validated %s sticker', (_format, filename, mime, bytes) => {
    expect(
      validateMedia({
        bytes,
        declaredMimeType: mime,
        filename,
        kind: 'STICKER',
        maximumBytes: 600 * 1024,
      }),
    ).toMatchObject({ mimeType: mime });
  });

  it('accepts browser-generic MIME for a signature-verified TGS sticker', () => {
    expect(
      validateMedia({
        bytes: Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0]),
        declaredMimeType: 'application/octet-stream',
        filename: 'animated.tgs',
        kind: 'STICKER',
        maximumBytes: 100,
      }),
    ).toMatchObject({ extension: 'tgs', mimeType: 'application/x-tgsticker' });
  });

  it('rejects a static sticker without a 512-pixel side', () => {
    expect(() =>
      validateMedia({
        bytes: webp(400, 400),
        declaredMimeType: 'image/webp',
        filename: 'sticker.webp',
        kind: 'STICKER',
        maximumBytes: 600 * 1024,
      }),
    ).toThrow(expect.objectContaining({ code: 'media_sticker_dimensions_rejected' }));
  });

  it('normalizes a static WebP sticker to Telegram dimensions', async () => {
    const source = await sharp({
      create: {
        background: { alpha: 0.8, b: 40, g: 120, r: 220 },
        channels: 4,
        height: 300,
        width: 400,
      },
    })
      .webp()
      .toBuffer();

    await expect(
      prepareMediaForTelegram({
        bytes: source,
        declaredMimeType: 'image/webp',
        filename: 'sticker.webp',
        kind: 'STICKER',
        maximumBytes: 20 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({
      extension: 'webp',
      height: 384,
      mimeType: 'image/webp',
      transformed: true,
      width: 512,
    });
  });

  it('accepts complete PDF and empty ZIP documents without transforming them', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
    const zip = Uint8Array.from([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    await expect(
      prepareMediaForTelegram({
        bytes: pdf,
        declaredMimeType: 'application/pdf',
        filename: 'document.pdf',
        kind: 'DOCUMENT',
        maximumBytes: 1_000,
      }),
    ).resolves.toMatchObject({
      extension: 'pdf',
      mimeType: 'application/pdf',
      transformed: false,
    });
    await expect(
      prepareMediaForTelegram({
        bytes: zip,
        declaredMimeType: 'application/zip',
        filename: 'archive.zip',
        kind: 'DOCUMENT',
        maximumBytes: 1_000,
      }),
    ).resolves.toMatchObject({
      extension: 'zip',
      mimeType: 'application/zip',
      transformed: false,
    });
  });

  it('preserves a signature-verified Office Open XML document identity', async () => {
    const localEntries = Buffer.from(
      'PK\u0003\u0004[Content_Types].xml word/document.xml',
      'binary',
    );
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.set([0x50, 0x4b, 0x05, 0x06]);
    const docx = Buffer.concat([localEntries, endOfCentralDirectory]);

    await expect(
      prepareMediaForTelegram({
        bytes: docx,
        declaredMimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'document.docx',
        kind: 'DOCUMENT',
        maximumBytes: 1_000,
      }),
    ).resolves.toMatchObject({
      extension: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      transformed: false,
    });
  });

  it('materializes a signature-validated MP4 that Telegram classified as a document', async () => {
    const mp4 = Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);

    await expect(
      prepareMediaForTelegram({
        bytes: mp4,
        declaredMimeType: 'video/mp4',
        filename: 'telegram-animation.mp4',
        kind: 'DOCUMENT',
        maximumBytes: 1_000,
      }),
    ).resolves.toMatchObject({
      extension: 'mp4',
      mimeType: 'video/mp4',
      transformed: false,
    });
  });

  it.each([
    ['ANIMATION', 'welcome.gif', 'image/gif', new TextEncoder().encode('GIF89a-content')],
    [
      'VIDEO',
      'demo.mp4',
      'video/mp4',
      Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
    ],
    [
      'VIDEO_NOTE',
      'note.mp4',
      'video/mp4',
      Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
    ],
    ['AUDIO', 'track.mp3', 'audio/mpeg', Uint8Array.from([0x49, 0x44, 0x33, 1])],
    ['VOICE', 'voice.ogg', 'audio/ogg', new TextEncoder().encode('OggS-content')],
  ] as const)(
    'accepts validated %s payloads without transcoding',
    async (kind, filename, mime, bytes) => {
      await expect(
        prepareMediaForTelegram({
          bytes,
          declaredMimeType: mime,
          filename,
          kind,
          maximumBytes: 1_000,
        }),
      ).resolves.toMatchObject({ mimeType: mime, transformed: false });
    },
  );

  it('rejects truncated PDF and ZIP documents', () => {
    expect(() =>
      validateMedia({
        bytes: new TextEncoder().encode('%PDF-1.4\ntruncated'),
        filename: 'broken.pdf',
        kind: 'DOCUMENT',
        maximumBytes: 1_000,
      }),
    ).toThrow(expect.objectContaining({ code: 'media_pdf_structure_invalid' }));
    expect(() =>
      validateMedia({
        bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
        filename: 'broken.zip',
        kind: 'DOCUMENT',
        maximumBytes: 1_000,
      }),
    ).toThrow(expect.objectContaining({ code: 'media_zip_structure_invalid' }));
  });
});

describe('WhatsApp media validation', () => {
  const webpSticker = (animated: boolean) => {
    const bytes = new Uint8Array(30);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x56, 0x50, 0x38, 0x58], 12);
    bytes[20] = animated ? 0x02 : 0;
    bytes.set([0xff, 0x01, 0], 24);
    bytes.set([0xff, 0x01, 0], 27);
    return bytes;
  };

  it('accepts a positively identified OGG/Opus audio file', async () => {
    const bytes = Buffer.from('OggS\u0000\u0000\u0000\u0000OpusHead', 'binary');
    await expect(
      prepareMediaForWhatsApp({
        bytes,
        declaredMimeType: 'audio/ogg',
        filename: 'voice.ogg',
        kind: 'VOICE',
        maximumBytes: 20 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({ mimeType: 'audio/ogg', transformed: false });
  });

  it('rejects an OGG container that cannot be identified as Opus', async () => {
    await expect(
      prepareMediaForWhatsApp({
        bytes: Buffer.from('OggS\u0000\u0000Vorbis', 'binary'),
        declaredMimeType: 'audio/ogg',
        filename: 'spoofed.ogg',
        kind: 'VOICE',
        maximumBytes: 20 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'whatsapp_ogg_opus_required' });
  });

  it('accepts a static 512px WebP sticker and rejects an animated one', async () => {
    await expect(
      prepareMediaForWhatsApp({
        bytes: webpSticker(false),
        declaredMimeType: 'image/webp',
        filename: 'sticker.webp',
        kind: 'STICKER',
        maximumBytes: 20 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({ height: 512, width: 512 });
    await expect(
      prepareMediaForWhatsApp({
        bytes: webpSticker(true),
        declaredMimeType: 'image/webp',
        filename: 'animated.webp',
        kind: 'STICKER',
        maximumBytes: 20 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'whatsapp_sticker_dimensions_rejected' });
  });

  it('normalizes a static WebP sticker to the WhatsApp square contract', async () => {
    const source = await sharp({
      create: {
        background: { alpha: 0.8, b: 40, g: 120, r: 220 },
        channels: 4,
        height: 300,
        width: 400,
      },
    })
      .webp()
      .toBuffer();
    const prepared = await prepareMediaForWhatsApp({
      bytes: source,
      declaredMimeType: 'image/webp',
      filename: 'sticker.webp',
      kind: 'STICKER',
      maximumBytes: 20 * 1024 * 1024,
    });

    expect(prepared).toMatchObject({
      extension: 'webp',
      height: 512,
      mimeType: 'image/webp',
      transformed: true,
      width: 512,
    });
    expect(prepared.sizeBytes).toBeLessThanOrEqual(100 * 1024);
  });

  it('recognizes an Office Open XML document without trusting its MIME alone', async () => {
    const bytes = Buffer.from('PK\u0003\u0004[Content_Types].xml word/document.xml', 'binary');
    await expect(
      prepareMediaForWhatsApp({
        bytes,
        declaredMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'document.docx',
        kind: 'DOCUMENT',
        maximumBytes: 20 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({ extension: 'docx' });
  });
});

describe('template rendering', () => {
  it('renders known paths and reports missing values', () => {
    expect(
      renderTemplate('Hello {{contact.firstName}} {{contact.missing}}', {
        contact: { firstName: 'Eldar' },
      }),
    ).toEqual({ missing: ['contact.missing'], output: 'Hello Eldar ' });
  });

  it('does not implicitly stringify object variables', () => {
    expect(() =>
      renderTemplate('{{contact.customFields}}', { contact: { customFields: {} } }),
    ).toThrow('template_variable_must_be_scalar');
  });

  it('enforces the rendered output limit', () => {
    expect(() => renderTemplate('{{value}}', { value: 'too long' }, 3)).toThrow(
      'template_output_too_large',
    );
  });

  it('renders media captions while preserving immutable snapshot fields', () => {
    expect(
      renderMessageTemplateContent(
        {
          caption: 'Hello {{contact.firstName}}',
          kind: 'PHOTO',
          mediaAssetId: 'asset-a',
          templateVersionId: 'version-a',
        },
        { contact: { firstName: 'Eldar' } },
      ),
    ).toEqual({
      content: {
        caption: 'Hello Eldar',
        kind: 'PHOTO',
        mediaAssetId: 'asset-a',
        templateVersionId: 'version-a',
      },
      missing: [],
    });
  });
});
