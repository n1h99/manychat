import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, MinLength } from 'class-validator';

export class CreateTelegramChannelDto {
  @ApiProperty({ type: String }) @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ format: 'password', type: String, writeOnly: true })
  @IsString()
  @MinLength(8)
  botToken!: string;
}

export class UpdateTelegramChannelDto {
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ format: 'password', type: String, writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(8)
  botToken?: string;
}

export class TestTelegramMessageDto {
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() channelIdentityId?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() contactId?: string;
  @ApiProperty({ type: String }) @IsString() @Length(1, 4096) text!: string;
  @ApiProperty({ type: String }) @IsString() @Length(8, 200) idempotencyKey!: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @IsBoolean() disableNotification?: boolean;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() replyToMessageId?: string;
}
