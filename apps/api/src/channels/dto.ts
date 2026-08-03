import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTelegramChannelDto {
  @ApiPropertyOptional({ enum: ['TELEGRAM', 'WHATSAPP'] })
  @IsOptional()
  @IsIn(['TELEGRAM', 'WHATSAPP'])
  type?: 'TELEGRAM' | 'WHATSAPP';

  @ApiProperty({ type: String }) @IsString() @Length(1, 120) name!: string;
  @ApiPropertyOptional({ format: 'password', type: String, writeOnly: true })
  @ValidateIf((value: CreateTelegramChannelDto) => (value.type ?? 'TELEGRAM') === 'TELEGRAM')
  @IsString()
  @MinLength(8)
  botToken?: string;

  @ApiPropertyOptional({ format: 'password', type: String, writeOnly: true })
  @ValidateIf(
    (value: CreateTelegramChannelDto) =>
      value.type === 'WHATSAPP' && value.accessToken !== undefined,
  )
  @IsString()
  @MinLength(16)
  accessToken?: string;

  @ApiPropertyOptional({ type: String })
  @ValidateIf(
    (value: CreateTelegramChannelDto) =>
      value.type === 'WHATSAPP' && value.businessAccountId !== undefined,
  )
  @IsString()
  @Length(1, 32)
  @Matches(/^\d+$/)
  businessAccountId?: string;

  @ApiPropertyOptional({ type: String })
  @ValidateIf(
    (value: CreateTelegramChannelDto) =>
      value.type === 'WHATSAPP' && value.phoneNumberId !== undefined,
  )
  @IsString()
  @Length(1, 32)
  @Matches(/^\d+$/)
  phoneNumberId?: string;

  @ApiPropertyOptional({ example: 'vXX.X', type: String })
  @ValidateIf(
    (value: CreateTelegramChannelDto) =>
      value.type === 'WHATSAPP' && value.graphApiVersion !== undefined,
  )
  @IsString()
  @Matches(/^v\d+\.\d+$/)
  graphApiVersion?: string;
}

export class UpdateTelegramChannelDto {
  @ApiPropertyOptional({ enum: ['TELEGRAM', 'WHATSAPP'] })
  @IsOptional()
  @IsIn(['TELEGRAM', 'WHATSAPP'])
  type?: 'TELEGRAM' | 'WHATSAPP';

  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ format: 'password', type: String, writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(8)
  botToken?: string;

  @ApiPropertyOptional({ format: 'password', type: String, writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(16)
  accessToken?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(/^\d+$/)
  businessAccountId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(/^\d+$/)
  phoneNumberId?: string;

  @ApiPropertyOptional({ example: 'vXX.X', type: String })
  @IsOptional()
  @IsString()
  @Matches(/^v\d+\.\d+$/)
  graphApiVersion?: string;
}

export class CompleteWhatsAppSetupDto {
  @ApiProperty({ type: String }) @IsString() @Length(1, 2048) code!: string;
  @ApiPropertyOptional({ format: 'uuid', type: String })
  @IsOptional()
  @IsUUID()
  connectionId?: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 32) @Matches(/^\d+$/) wabaId!: string;
  @ApiProperty({ type: String })
  @IsString()
  @Length(1, 32)
  @Matches(/^\d+$/)
  phoneNumberId!: string;
  @ApiProperty({ format: 'password', type: String, writeOnly: true })
  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;
}

export class TestTelegramMessageDto {
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() channelIdentityId?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() contactId?: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 4096) text!: string;
  @ApiProperty({ type: String }) @IsString() @Length(8, 200) idempotencyKey!: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @IsBoolean() disableNotification?: boolean;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() replyToMessageId?: string;
}
