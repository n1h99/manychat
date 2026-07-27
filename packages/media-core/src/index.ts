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
  mimeType: string;
  sizeBytes: number;
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
  return {
    extension: signature.extension,
    mimeType: signature.mimeType,
    sizeBytes: input.bytes.byteLength,
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
