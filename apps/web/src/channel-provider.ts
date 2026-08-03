import type { Channel, ChannelType, WhatsAppChannel } from './channels-api';

export const channelProviderCopy: Record<
  ChannelType,
  {
    accountLabel: string;
    channelLabel: string;
    connectionNoun: string;
    messageIdLabel: string;
    recipientLabel: string;
  }
> = {
  TELEGRAM: {
    accountLabel: 'Bot',
    channelLabel: 'Telegram',
    connectionNoun: 'bot connection',
    messageIdLabel: 'Telegram message ID',
    recipientLabel: 'Telegram contact',
  },
  WHATSAPP: {
    accountLabel: 'Business phone',
    channelLabel: 'WhatsApp',
    connectionNoun: 'business connection',
    messageIdLabel: 'WhatsApp message ID',
    recipientLabel: 'WhatsApp contact',
  },
};

const whatsappConfigurationLabelMap: Record<string, string> = {
  accessToken: 'Permanent access token',
  appSecret: 'Meta app secret',
  businessAccountId: 'WhatsApp Business Account ID',
  configurationId: 'Embedded Signup configuration ID',
  graphApiVersion: 'Graph API version',
  metaAppId: 'Meta App ID',
  metaAppSecret: 'Meta app secret (server setting)',
  phoneNumberId: 'Phone Number ID',
  verifyToken: 'Webhook verification token',
  webhookVerifyToken: 'Webhook verification token (server setting)',
};

export function channelProviderLabel(type: ChannelType): string {
  return channelProviderCopy[type].channelLabel;
}

export function channelAccountLabel(channel: Channel): string {
  if (channel.type === 'TELEGRAM') {
    return channel.botUsername ? `@${channel.botUsername}` : 'Bot not verified yet';
  }
  return (
    channel.displayPhoneNumber ??
    channel.verifiedName ??
    channel.phoneNumberId ??
    'Business phone not connected yet'
  );
}

export function isWhatsAppChannel(channel: Channel): channel is WhatsAppChannel {
  return channel.type === 'WHATSAPP';
}

export function whatsappMissingConfiguration(channel: WhatsAppChannel): string[] {
  return whatsappConfigurationLabels(channel.missingConfiguration);
}

export function whatsappConfigurationLabels(fields: string[]): string[] {
  return fields.map(
    (field) => whatsappConfigurationLabelMap[field] ?? humanizeConfigurationField(field),
  );
}

function humanizeConfigurationField(field: string): string {
  const label = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim()
    .toLowerCase();
  return label ? `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}` : 'Required setting';
}

export function providerPipelineCopy(type: ChannelType) {
  const provider = channelProviderLabel(type);
  return {
    inboundEmpty: `No ${provider} updates received yet`,
    inboundFailure: `${provider} inbound processing failed`,
    outboundEmpty: `No ${provider} messages created yet`,
    outboundFailure: `${provider} delivery failed`,
    unknown: `${provider} delivery has an unknown result. Reconcile it before any retry.`,
  };
}
