import { describe, expect, it } from 'vitest';

import type { TelegramChannel, WhatsAppChannel } from './channels-api';
import {
  channelAccountLabel,
  channelProviderLabel,
  providerPipelineCopy,
  whatsappMissingConfiguration,
} from './channel-provider';

const common = {
  createdAt: '2026-08-03T00:00:00.000Z',
  id: 'connection-1',
  lastErrorAt: null,
  lastWebhookAt: null,
  name: 'Support',
  projectId: 'project-1',
  status: 'DRAFT' as const,
  updatedAt: '2026-08-03T00:00:00.000Z',
  webhookStatus: 'NOT_CONNECTED',
};

describe('channel provider presentation', () => {
  it('keeps Telegram and WhatsApp account identity distinct', () => {
    const telegram: TelegramChannel = {
      ...common,
      botUsername: 'support_bot',
      externalBotId: 'bot-1',
      maskedToken: '1234:***',
      type: 'TELEGRAM',
    };
    const whatsapp: WhatsAppChannel = {
      ...common,
      businessAccountId: 'waba-1',
      configured: true,
      displayPhoneNumber: '+1 555 0100',
      graphApiVersion: 'v23.0',
      maskedToken: 'EAAB***wxyz',
      missingConfiguration: [],
      phoneNumberId: 'phone-1',
      setupMode: 'MANUAL',
      setupReady: true,
      type: 'WHATSAPP',
      verifiedName: 'Omnicus Support',
    };

    expect(channelProviderLabel(telegram.type)).toBe('Telegram');
    expect(channelAccountLabel(telegram)).toBe('@support_bot');
    expect(channelProviderLabel(whatsapp.type)).toBe('WhatsApp');
    expect(channelAccountLabel(whatsapp)).toBe('+1 555 0100');
  });

  it('turns safe setup keys into operator-facing labels', () => {
    const whatsapp: WhatsAppChannel = {
      ...common,
      businessAccountId: null,
      configured: false,
      displayPhoneNumber: null,
      graphApiVersion: null,
      maskedToken: null,
      missingConfiguration: ['accessToken', 'phoneNumberId', 'custom_field'],
      phoneNumberId: null,
      setupMode: 'MANUAL',
      setupReady: false,
      type: 'WHATSAPP',
      verifiedName: null,
    };

    expect(whatsappMissingConfiguration(whatsapp)).toEqual([
      'Permanent access token',
      'Phone Number ID',
      'Custom field',
    ]);
  });

  it('uses provider-specific pipeline language', () => {
    expect(providerPipelineCopy('WHATSAPP').unknown).toContain('WhatsApp delivery');
    expect(providerPipelineCopy('TELEGRAM').inboundEmpty).toContain('Telegram updates');
  });
});
