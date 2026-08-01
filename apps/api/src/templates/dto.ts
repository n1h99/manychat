import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

const templateKinds = [
  'TEXT',
  'PHOTO',
  'DOCUMENT',
  'VIDEO',
  'AUDIO',
  'VOICE',
  'VIDEO_NOTE',
  'ANIMATION',
  'STICKER',
] as const;

type TemplateKind = (typeof templateKinds)[number];

export class CreateMessageTemplateDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) description?: string;
  @ApiProperty({ enum: templateKinds })
  @IsIn(templateKinds)
  kind!: TemplateKind;
  @ApiPropertyOptional()
  @ValidateIf((value: CreateMessageTemplateDto) => value.kind === 'TEXT')
  @IsString()
  @Length(1, 4096)
  text?: string;
  @ApiPropertyOptional()
  @ValidateIf((value: CreateMessageTemplateDto) => value.kind !== 'TEXT')
  @IsUUID()
  mediaAssetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1024) caption?: string;
  @ApiPropertyOptional({
    description: 'Rows of provider-independent inline keyboard buttons',
    isArray: true,
    type: 'array',
  })
  @IsOptional()
  @IsArray()
  inlineKeyboard?: unknown[];
}

export class UpdateMessageTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) description?: string;
  @ApiPropertyOptional({ enum: templateKinds })
  @IsOptional()
  @IsIn(templateKinds)
  kind?: TemplateKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 4096) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() mediaAssetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1024) caption?: string;
  @ApiPropertyOptional({
    description: 'Rows of provider-independent inline keyboard buttons',
    isArray: true,
    type: 'array',
  })
  @IsOptional()
  @IsArray()
  inlineKeyboard?: unknown[];
}

export class PreviewMessageTemplateDto {
  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}
