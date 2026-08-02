import { IsObject, IsOptional, IsString, Length } from 'class-validator';

export class CreateAutomationSecretDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 16_384)
  value!: string;
}

export class UpdateAutomationSecretDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 16_384)
  value?: string;
}

export class TestExternalHttpRequestDto {
  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}
