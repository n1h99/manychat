import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
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
