export type ChannelType = 'instagram' | 'telegram' | 'whatsapp';

export interface ChannelCapabilities {
  broadcasts: boolean;
  deliveryStatuses: boolean;
  incoming: Readonly<Record<string, boolean>>;
  outgoing: Readonly<Record<string, boolean>>;
  readStatuses: boolean;
}

export interface ChannelAdapterDescriptor {
  capabilities: ChannelCapabilities;
  channel: ChannelType;
  version: string;
}
