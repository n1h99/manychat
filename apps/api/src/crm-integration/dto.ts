import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CrmOutboundIdentityDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  channelIdentityId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  connectionId!: string;

  @ApiProperty({ enum: ['telegram'] })
  @IsIn(['telegram'])
  channel!: 'telegram';
}

const crmOutboundMediaKinds = [
  'PHOTO',
  'DOCUMENT',
  'VIDEO',
  'AUDIO',
  'VOICE',
  'VIDEO_NOTE',
  'ANIMATION',
] as const;

export class CrmOutboundMediaDto {
  @ApiProperty({ enum: crmOutboundMediaKinds })
  @IsIn(crmOutboundMediaKinds)
  kind!: (typeof crmOutboundMediaKinds)[number];

  @ApiProperty({ format: 'uuid', type: String })
  @IsUUID()
  mediaAssetId!: string;
}

export class CrmMediaUploadDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  crmProjectId!: string;

  @ApiProperty({ enum: crmOutboundMediaKinds })
  @IsIn(crmOutboundMediaKinds)
  kind!: (typeof crmOutboundMediaKinds)[number];

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusProjectId!: string;
}

export class CrmOutboundMessageDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  crmProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusContactId!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  crmLeadId?: string;

  @ApiProperty({ type: CrmOutboundIdentityDto })
  @Type(() => CrmOutboundIdentityDto)
  @ValidateNested()
  identity!: CrmOutboundIdentityDto;

  @ApiPropertyOptional({ maxLength: 4096, type: String })
  @IsOptional()
  @IsString()
  @Length(1, 4096)
  text?: string;

  @ApiPropertyOptional({ type: CrmOutboundMediaDto })
  @IsOptional()
  @Type(() => CrmOutboundMediaDto)
  @ValidateNested()
  media?: CrmOutboundMediaDto;

  @ApiPropertyOptional({
    description: 'Rows of provider-independent Telegram inline keyboard buttons',
    isArray: true,
    type: 'array',
  })
  @IsOptional()
  @IsArray()
  inlineKeyboard?: unknown[];

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  disableNotification?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  protectContent?: boolean;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  messageEffectId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  linkPreviewOptions?: Record<string, unknown>;

  @ApiPropertyOptional({ isArray: true, type: Object })
  @IsOptional()
  @IsArray()
  entities?: unknown[];

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  quote?: string;

  @ApiPropertyOptional({ maximum: 4096, minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4096)
  quotePosition?: number;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class CrmTelegramScopeDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  crmProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusContactId!: string;

  @ApiProperty({ type: CrmOutboundIdentityDto })
  @Type(() => CrmOutboundIdentityDto)
  @ValidateNested()
  identity!: CrmOutboundIdentityDto;
}

export class CrmCapabilitiesQueryDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  crmProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  connectionId!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  omnicusContactId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  channelIdentityId?: string;
}

const crmChatActions = [
  'TYPING',
  'RECORD_VOICE',
  'UPLOAD_PHOTO',
  'UPLOAD_VIDEO',
  'UPLOAD_DOCUMENT',
  'RECORD_VIDEO_NOTE',
] as const;

export class CrmChatActionDto extends CrmTelegramScopeDto {
  @ApiProperty({ enum: crmChatActions })
  @IsIn(crmChatActions)
  action!: (typeof crmChatActions)[number];
}

export class CrmReactionDto extends CrmTelegramScopeDto {
  @ApiProperty({ enum: ['emoji', 'custom_emoji'] })
  @IsIn(['emoji', 'custom_emoji'])
  type!: 'custom_emoji' | 'emoji';

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  value!: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  isBig?: boolean;
}

export class CrmMessageMutationDto extends CrmTelegramScopeDto {
  @ApiPropertyOptional({ maxLength: 4096, type: String })
  @IsOptional()
  @IsString()
  @Length(1, 4096)
  text?: string;

  @ApiPropertyOptional({ maxLength: 1024, type: String })
  @IsOptional()
  @IsString()
  @Length(0, 1024)
  caption?: string;

  @ApiPropertyOptional({ isArray: true, type: Object })
  @IsOptional()
  @IsArray()
  inlineKeyboard?: unknown[];

  @ApiPropertyOptional({ isArray: true, type: Object })
  @IsOptional()
  @IsArray()
  entities?: unknown[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  linkPreviewOptions?: Record<string, unknown>;
}

export class CrmPinMessageDto extends CrmTelegramScopeDto {
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  disableNotification?: boolean;
}

export class CrmDraftDto extends CrmTelegramScopeDto {
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  draftId!: number;

  @ApiPropertyOptional({ maxLength: 4096, type: String })
  @IsOptional()
  @IsString()
  @Length(0, 4096)
  text?: string;

  @ApiPropertyOptional({ isArray: true, type: Object })
  @IsOptional()
  @IsArray()
  entities?: unknown[];
}

export class CrmRetryOperationDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  crmProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  retryRequestId!: string;
}

export class CrmAutomationStateQueryDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  crmProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusContactId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  connectionId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  channelIdentityId!: string;
}

export class CrmAutomationStateDto extends CrmTelegramScopeDto {
  @ApiProperty({ enum: ['AUTO', 'MANUAL'] })
  @IsIn(['AUTO', 'MANUAL'])
  mode!: 'AUTO' | 'MANUAL';

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  reasonCode?: string;
}

export class CrmOperationQueryDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  crmProjectId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 128)
  omnicusProjectId!: string;
}
