import { describe, expect, it } from 'vitest';

import { parseWhatsAppEmbeddedSignupMessage } from './whatsapp-embedded-signup';

describe('WhatsApp Embedded Signup messages', () => {
  it('accepts only a finished session from an official Facebook origin', () => {
    expect(
      parseWhatsAppEmbeddedSignupMessage({
        data: {
          data: { phone_number_id: 'phone-1', waba_id: 'waba-1' },
          event: 'FINISH',
          type: 'WA_EMBEDDED_SIGNUP',
        },
        origin: 'https://www.facebook.com',
      }),
    ).toEqual({ phoneNumberId: 'phone-1', wabaId: 'waba-1' });
  });

  it('rejects untrusted origins and incomplete payloads', () => {
    const payload = {
      data: {
        data: { phone_number_id: 'phone-1', waba_id: 'waba-1' },
        event: 'FINISH',
        type: 'WA_EMBEDDED_SIGNUP',
      },
      origin: 'https://example.com',
    };
    expect(parseWhatsAppEmbeddedSignupMessage(payload)).toBeNull();
    expect(
      parseWhatsAppEmbeddedSignupMessage({
        data: JSON.stringify({ event: 'CANCEL', type: 'WA_EMBEDDED_SIGNUP' }),
        origin: 'https://www.facebook.com',
      }),
    ).toBeNull();
    expect(
      parseWhatsAppEmbeddedSignupMessage({
        data: {
          data: { phone_number_id: '   ', waba_id: 'waba-1' },
          event: 'FINISH',
          type: 'WA_EMBEDDED_SIGNUP',
        },
        origin: 'https://www.facebook.com',
      }),
    ).toBeNull();
  });
});
