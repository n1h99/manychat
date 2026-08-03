import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class WhatsAppBroadcastTemplateDto {
  @ApiProperty()
  @IsUUID()
  templateId!: string;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  components?: Record<string, unknown>[];
}

export class BroadcastAudienceDto {
  @ApiProperty({ enum: ['ALL_ACTIVE', 'SEGMENT', 'CONTACTS'] })
  @IsIn(['ALL_ACTIVE', 'SEGMENT', 'CONTACTS'])
  mode!: 'ALL_ACTIVE' | 'SEGMENT' | 'CONTACTS';

  @ApiPropertyOptional()
  @ValidateIf((value: BroadcastAudienceDto) => value.mode === 'SEGMENT')
  @IsString()
  segmentId?: string;

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((value: BroadcastAudienceDto) => value.mode === 'CONTACTS')
  @IsArray()
  @IsString({ each: true })
  contactIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includeTagIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeTagIds?: string[];
}

export class CreateBroadcastDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty() @IsString() connectionId!: string;
  @ApiProperty({ type: BroadcastAudienceDto })
  @ValidateNested()
  @Type(() => BroadcastAudienceDto)
  audience!: BroadcastAudienceDto;
  @ApiPropertyOptional()
  @ValidateIf((value: CreateBroadcastDto) => !value.templateVersionId && !value.whatsAppTemplate)
  @IsString()
  @Length(1, 4096)
  text?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() templateVersionId?: string;
  @ApiPropertyOptional({ type: WhatsAppBroadcastTemplateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppBroadcastTemplateDto)
  whatsAppTemplate?: WhatsAppBroadcastTemplateDto;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class UpdateBroadcastDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ type: BroadcastAudienceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastAudienceDto)
  audience?: BroadcastAudienceDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 4096) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() templateVersionId?: string;
  @ApiPropertyOptional({ type: WhatsAppBroadcastTemplateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsAppBroadcastTemplateDto)
  whatsAppTemplate?: WhatsAppBroadcastTemplateDto;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;
}

export class BroadcastRecipientsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 50;
  @ApiPropertyOptional({
    enum: ['PENDING', 'QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED', 'UNKNOWN'],
  })
  @IsOptional()
  @IsString()
  status?: string;
}
