import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({ maxLength: 4096, type: String })
  @IsString()
  @Length(1, 4096)
  text!: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  disableNotification?: boolean;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 128)
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
