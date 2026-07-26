import { IsObject, IsOptional, IsString, Length } from 'class-validator';

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
