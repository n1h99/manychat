import { IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2_000)
  description?: string;

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
  @IsString()
  @Length(1, 2_000)
  description?: string;

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

export class AddMemberDto extends UpdateMembershipDto {
  @IsString()
  userId!: string;
}
