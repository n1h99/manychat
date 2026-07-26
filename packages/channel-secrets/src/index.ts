import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecretEnvelope {
  algorithm: 'aes-256-gcm';
  authTag: string;
  ciphertext: string;
  iv: string;
  keyVersion: 1;
  version: 1;
}
export interface SecretContext {
  channelConnectionId: string;
  channelType: string;
  field: string;
  projectId: string;
}
export class ChannelSecretsService {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('Invalid channel secrets key');
  }
  encryptSecret(input: SecretContext & { plaintext: string }): EncryptedSecretEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(this.aad(input)));
    const ciphertext = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()]);
    return {
      algorithm: 'aes-256-gcm',
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      keyVersion: 1,
      version: 1,
    };
  }
  decryptSecret(input: SecretContext & { envelope: EncryptedSecretEnvelope }): string {
    const { envelope } = input;
    if (envelope.version !== 1 || envelope.keyVersion !== 1 || envelope.algorithm !== 'aes-256-gcm')
      throw new Error('Unsupported encrypted secret envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(this.aad(input)));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
  rotateSecret(input: SecretContext & { plaintext: string }): EncryptedSecretEnvelope {
    return this.encryptSecret(input);
  }
  private aad(input: SecretContext): string {
    return `${input.projectId}:${input.channelConnectionId}:${input.channelType}:${input.field}`;
  }
}
export function maskTelegramToken(token: string): string {
  const separator = token.indexOf(':');
  const prefix = separator === -1 ? '' : token.slice(0, separator + 1);
  return `${prefix}${'*'.repeat(20)}${token.slice(-4)}`;
}
