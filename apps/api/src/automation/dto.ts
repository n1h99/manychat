import { IsISO8601, IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';

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
