import { describe, expect, it } from 'vitest';

import {
  MediaValidationError,
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
