import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type MediaKind = 'DOCUMENT' | 'PHOTO';

export interface MediaStorageConfiguration {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle?: boolean;
  region: string;
  secretAccessKey: string;
}

export class S3MediaStorage {
  private readonly client: S3Client;

  constructor(private readonly configuration: MediaStorageConfiguration) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
      endpoint: configuration.endpoint,
      forcePathStyle: configuration.forcePathStyle ?? false,
      region: configuration.region,
    });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: key }),
    );
  }

  async getObject(key: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.configuration.bucket, Key: key }),
    );
    if (!response.Body) throw new Error('media_storage_object_body_missing');
    return {
      bytes: await response.Body.transformToByteArray(),
      ...(response.ContentType ? { contentType: response.ContentType } : {}),
    };
  }

  async putObject(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: bytes,
        Bucket: this.configuration.bucket,
        ContentType: contentType,
        Key: key,
        Metadata: metadata,
      }),
    );
  }

  async signedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.configuration.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}

export interface MediaValidationInput {
  bytes: Uint8Array;
  declaredMimeType?: string;
  filename?: string;
  kind: MediaKind;
  maximumBytes: number;
}

export interface ValidatedMedia {
  extension: string;
  height?: number;
  mimeType: string;
  sizeBytes: number;
  width?: number;
}

interface ImageDimensions {
  height: number;
  width: number;
}

const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const TELEGRAM_PHOTO_MAX_DIMENSION_SUM = 10_000;
const TELEGRAM_PHOTO_MAX_ASPECT_RATIO = 20;

function readBigEndian16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 256 + bytes[offset + 1]!;
}

function readLittleEndian16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 256;
}

function readLittleEndian24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65_536;
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (
    bytes.byteLength < 24 ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  )
    return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return undefined;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
      continue;
    if (offset + 1 >= bytes.byteLength) return undefined;
    const segmentLength = readBigEndian16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return undefined;
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return undefined;
      return {
        height: readBigEndian16(bytes, offset + 3),
        width: readBigEndian16(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return undefined;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.byteLength < 30) return undefined;
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === 'VP8X')
    return {
      height: readLittleEndian24(bytes, 27) + 1,
      width: readLittleEndian24(bytes, 24) + 1,
    };
  if (chunk === 'VP8 ') {
    if (bytes.byteLength < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
      return undefined;
    return {
      height: readLittleEndian16(bytes, 28) & 0x3fff,
      width: readLittleEndian16(bytes, 26) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    if (bytes.byteLength < 25 || bytes[20] !== 0x2f) return undefined;
    return {
      height: 1 + ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10)),
      width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
    };
  }
  return undefined;
}

function imageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | undefined {
  if (mimeType === 'image/png') return pngDimensions(bytes);
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes);
  if (mimeType === 'image/webp') return webpDimensions(bytes);
  return undefined;
}

function validateTelegramPhoto(bytes: Uint8Array, mimeType: string): ImageDimensions {
  if (bytes.byteLength > TELEGRAM_PHOTO_MAX_BYTES)
    throw new MediaValidationError('media_photo_size_exceeded');
  const dimensions = imageDimensions(bytes, mimeType);
  if (!dimensions || dimensions.width === 0 || dimensions.height === 0)
    throw new MediaValidationError('media_photo_dimensions_unreadable');
  const aspectRatio =
    Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height);
  if (
    dimensions.width + dimensions.height > TELEGRAM_PHOTO_MAX_DIMENSION_SUM ||
    aspectRatio > TELEGRAM_PHOTO_MAX_ASPECT_RATIO
  )
    throw new MediaValidationError('media_photo_dimensions_rejected');
  return dimensions;
}

const signatures = [
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    matches: (bytes: Uint8Array) =>
      [0xff, 0xd8, 0xff].every((value, index) => bytes[index] === value),
  },
  {
    extension: 'png',
    mimeType: 'image/png',
    matches: (bytes: Uint8Array) =>
      [0x89, 0x50, 0x4e, 0x47].every((value, index) => bytes[index] === value),
  },
  {
    extension: 'webp',
    mimeType: 'image/webp',
    matches: (bytes: Uint8Array) =>
      [0x52, 0x49, 0x46, 0x46].every((value, index) => bytes[index] === value) &&
      [0x57, 0x45, 0x42, 0x50].every((value, index) => bytes[index + 8] === value),
  },
  {
    extension: 'pdf',
    mimeType: 'application/pdf',
    matches: (bytes: Uint8Array) =>
      [0x25, 0x50, 0x44, 0x46].every((value, index) => bytes[index] === value),
  },
  {
    extension: 'zip',
    mimeType: 'application/zip',
    matches: (bytes: Uint8Array) =>
      [0x50, 0x4b, 0x03, 0x04].every((value, index) => bytes[index] === value),
  },
] as const;

const allowedMimeTypes: Record<MediaKind, ReadonlySet<string>> = {
  DOCUMENT: new Set(['application/pdf', 'application/zip']),
  PHOTO: new Set(['image/jpeg', 'image/png', 'image/webp']),
};

export class MediaValidationError extends Error {
  constructor(readonly code: string) {
    super('Media validation failed');
    this.name = 'MediaValidationError';
  }
}

export function validateMedia(input: MediaValidationInput): ValidatedMedia {
  if (input.bytes.byteLength === 0) throw new MediaValidationError('media_empty');
  if (input.bytes.byteLength > input.maximumBytes)
    throw new MediaValidationError('media_size_exceeded');
  const signature = signatures.find((candidate) => candidate.matches(input.bytes));
  if (!signature || !allowedMimeTypes[input.kind].has(signature.mimeType))
    throw new MediaValidationError('media_type_rejected');
  if (input.declaredMimeType && input.declaredMimeType !== signature.mimeType)
    throw new MediaValidationError('media_mime_mismatch');
  const filenameExtension = input.filename?.split('.').pop()?.toLowerCase();
  if (
    filenameExtension &&
    filenameExtension !== 'jpeg' &&
    filenameExtension !== signature.extension
  )
    throw new MediaValidationError('media_extension_mismatch');
  const dimensions =
    input.kind === 'PHOTO' ? validateTelegramPhoto(input.bytes, signature.mimeType) : undefined;
  return {
    extension: signature.extension,
    ...(dimensions ? { height: dimensions.height } : {}),
    mimeType: signature.mimeType,
    sizeBytes: input.bytes.byteLength,
    ...(dimensions ? { width: dimensions.width } : {}),
  };
}

const templateExpression = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function templateVariables(template: string): string[] {
  return [...template.matchAll(templateExpression)]
    .map((match) => match[1]!)
    .filter((value, index, values) => values.indexOf(value) === index);
}

export function renderTemplate(
  template: string,
  variables: Readonly<Record<string, unknown>>,
  maximumOutputLength = 4_096,
): { missing: string[]; output: string } {
  const missing = new Set<string>();
  const output = template.replace(templateExpression, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[part];
    }, variables);
    if (value === undefined || value === null) {
      missing.add(path);
      return '';
    }
    if (typeof value === 'object') throw new Error('template_variable_must_be_scalar');
    return String(value);
  });
  if (output.length > maximumOutputLength) throw new Error('template_output_too_large');
  return { missing: [...missing], output };
}

export function renderMessageTemplateContent(
  content: unknown,
  variables: Readonly<Record<string, unknown>>,
): { content: Record<string, unknown>; missing: string[] } {
  if (!content || typeof content !== 'object' || Array.isArray(content))
    throw new Error('template_content_invalid');
  const source = content as Record<string, unknown>;
  const field = source.kind === 'TEXT' ? 'text' : 'caption';
  const template = source[field];
  if (typeof template !== 'string') throw new Error('template_content_invalid');
  const rendered = renderTemplate(template, variables, field === 'caption' ? 1_024 : 4_096);
  return {
    content: { ...source, [field]: rendered.output },
    missing: rendered.missing,
  };
}
