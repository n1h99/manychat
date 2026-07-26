import { IsArray, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsString()
  @Length(12, 256)
  temporaryPassword!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  globalRoleIds?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  globalRoleIds?: string[];
}
