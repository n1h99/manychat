import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, Length, MinLength } from 'class-validator';

export class CreateTelegramChannelDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ format: 'password', writeOnly: true }) @IsString() @MinLength(8) botToken!: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false }) webhookBaseUrl?: string;
}

export class UpdateTelegramChannelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ format: 'password', writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(8)
  botToken?: string;
}

export class ConnectTelegramChannelDto {
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false }) webhookBaseUrl?: string;
}

export class TestTelegramMessageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() channelIdentityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactId?: string;
  @ApiProperty() @IsString() @Length(1, 4096) text!: string;
  @ApiProperty() @IsString() @Length(8, 200) idempotencyKey!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() disableNotification?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() replyToMessageId?: string;
}
