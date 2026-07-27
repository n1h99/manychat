import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class CreateMessageTemplateDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) description?: string;
  @ApiProperty({ enum: ['TEXT', 'PHOTO', 'DOCUMENT'] })
  @IsIn(['TEXT', 'PHOTO', 'DOCUMENT'])
  kind!: 'DOCUMENT' | 'PHOTO' | 'TEXT';
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
}

export class UpdateMessageTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) description?: string;
  @ApiPropertyOptional({ enum: ['TEXT', 'PHOTO', 'DOCUMENT'] })
  @IsOptional()
  @IsIn(['TEXT', 'PHOTO', 'DOCUMENT'])
  kind?: 'DOCUMENT' | 'PHOTO' | 'TEXT';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 4096) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() mediaAssetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1024) caption?: string;
}

export class PreviewMessageTemplateDto {
  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}
