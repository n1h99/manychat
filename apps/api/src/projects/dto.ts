import { Transform } from 'class-transformer';
import { IsArray, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

function optionalDescription({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

export class CreateProjectDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @Transform(optionalDescription)
  @IsString()
  @Length(1, 2_000)
  description?: string | null;

  @IsString()
  @Length(1, 100)
  timezone!: string;

  @IsString()
  @Length(2, 20)
  locale!: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @Transform(optionalDescription)
  @IsString()
  @Length(1, 2_000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 20)
  locale?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateMembershipDto {
  @IsString()
  projectRoleId!: string;
}

export class CloneProjectDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
}

export class CreateProjectRoleDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[];
}

export class UpdateProjectRoleDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class AddMemberDto extends UpdateMembershipDto {
  @IsString()
  userId!: string;
}
