import { IsArray, IsOptional, IsString, Length } from 'class-validator';

export class CreateGlobalRoleDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[];
}

export class UpdateGlobalRoleDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];
}
