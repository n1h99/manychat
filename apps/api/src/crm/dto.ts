import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export class UpsertCrmProjectConfigDto {
  @IsString()
  @Length(1, 160)
  crmProjectId!: string;

  @IsOptional()
  @IsObject()
  fieldMapping?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  defaultPipeline?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  defaultStage?: string;

  @IsOptional()
  @IsObject()
  additionalParameters?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Unknown delivery is deliberately not retried without an operator explicitly
 * accepting that a provider may already have applied the request.
 */
export class RetryCrmOperationDto {
  @IsOptional()
  @IsBoolean()
  confirmUnknownDelivery?: boolean;
}

export class StartCrmPairingDto {
  @IsString()
  @Length(1, 160)
  crmProjectId!: string;
}

export class CompleteCrmPairingDto {
  @IsString()
  @Length(20, 256)
  pairingCode!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(512)
  crmBaseUrl!: string;

  @IsString()
  @Length(1, 160)
  crmProjectId!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(32, 512)
  crmInboundAuthToken!: string;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}

export class CrmOperationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(10)
  @Max(100)
  pageSize = 50;
}
