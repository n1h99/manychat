import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const operationSources = ['INBOX', 'OUTBOX', 'AUTOMATION', 'BROADCAST'] as const;

export class OperationsQueryDto {
  @IsOptional()
  @IsIn(operationSources)
  source?: (typeof operationSources)[number];

  @IsOptional()
  @IsString()
  @Length(1, 40)
  status?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  correlationId?: string;

  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  action?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  correlationId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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

export class ManualRetryDto {
  @IsString()
  @Length(3, 500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  resetAttempts = true;
}

export class ReconcileUnknownDto {
  @IsIn(['APPLIED', 'NOT_APPLIED'])
  outcome!: 'APPLIED' | 'NOT_APPLIED';

  @IsString()
  @Length(3, 500)
  reason!: string;
}
