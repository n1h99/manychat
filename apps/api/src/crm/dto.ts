import { IsBoolean, IsObject, IsOptional, IsString, Length } from 'class-validator';

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
