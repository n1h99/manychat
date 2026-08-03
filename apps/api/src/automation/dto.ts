import { Type } from 'class-transformer';
import { IsISO8601, IsIn, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const executionStatuses = [
  'QUEUED',
  'RUNNING',
  'WAITING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export class AutomationActivityQueryDto {
  @IsOptional()
  @IsIn(executionStatuses)
  status?: (typeof executionStatuses)[number];

  @IsOptional()
  @IsString()
  scenarioId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  periodDays = 30;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(10)
  @Max(50)
  pageSize = 25;
}

export class CreateScenarioDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2_000)
  description?: string;

  @IsObject()
  graph!: Record<string, unknown>;
}

export class UpdateScenarioDto {
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2_000)
  description?: string | null;

  @IsOptional()
  @IsObject()
  graph?: Record<string, unknown>;
}

export class DuplicateScenarioDto {
  @IsString()
  @Length(1, 160)
  name!: string;
}

export class TestScenarioDto {
  @IsObject()
  graph!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  contact?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  event?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['reply', 'timeout'])
  waitOutcome?: 'reply' | 'timeout';

  @IsOptional()
  @IsIn(['success', 'failure'])
  httpOutcome?: 'success' | 'failure';
}
