import { describe, expect, it } from 'vitest';
import { ChannelSecretsService, maskTelegramToken } from './index';
const context = {
  channelConnectionId: 'connection-a',
  channelType: 'telegram',
  field: 'botToken',
  projectId: 'project-a',
};
describe('ChannelSecretsService', () => {
  const service = new ChannelSecretsService(Buffer.alloc(32, 9).toString('base64'));
  it('encrypts and decrypts with AAD', () => {
    const envelope = service.encryptSecret({
      ...context,
      plaintext: '123456:abcdefghijklmnopqrstuvwx',
    });
    expect(service.decryptSecret({ ...context, envelope })).toBe('123456:abcdefghijklmnopqrstuvwx');
  });
  it('uses a random IV and rejects tampering or a foreign context', () => {
    const first = service.encryptSecret({ ...context, plaintext: 'same' });
    const second = service.encryptSecret({ ...context, plaintext: 'same' });
    expect(first.ciphertext + first.iv).not.toBe(second.ciphertext + second.iv);
    expect(() =>
      service.decryptSecret({ ...context, channelConnectionId: 'other', envelope: first }),
    ).toThrow();
    expect(() =>
      service.decryptSecret({ ...context, envelope: { ...first, authTag: 'AAAA' } }),
    ).toThrow();
  });
  it('masks a token without exposing its middle', () =>
    expect(maskTelegramToken('123456:abcdefghijklmnopqrstuvwx')).toBe(
      '123456:********************uvwx',
    ));
});
