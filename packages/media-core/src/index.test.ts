import { describe, expect, it } from 'vitest';

import {
  MediaValidationError,
  renderMessageTemplateContent,
  renderTemplate,
  validateMedia,
} from './index';

describe('media validation', () => {
  it('accepts a matching JPEG photo', () => {
    expect(
      validateMedia({
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]),
        declaredMimeType: 'image/jpeg',
        filename: 'photo.jpg',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toMatchObject({ extension: 'jpg', mimeType: 'image/jpeg', sizeBytes: 4 });
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
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]),
        filename: 'photo.pdf',
        kind: 'PHOTO',
        maximumBytes: 3,
      }),
    ).toThrow(MediaValidationError);
    expect(() =>
      validateMedia({
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]),
        filename: 'photo.pdf',
        kind: 'PHOTO',
        maximumBytes: 100,
      }),
    ).toThrow(MediaValidationError);
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
