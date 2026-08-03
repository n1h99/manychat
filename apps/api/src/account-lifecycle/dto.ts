import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateGlobalInvitationDto {
  @IsEmail()
  email!: string;

  @IsString()
  globalRoleId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours = 72;
}

export class CreateProjectInvitationDto {
  @IsEmail()
  email!: string;

  @IsString()
  projectRoleId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours = 72;
}

export class TokenDto {
  @IsString()
  @Length(32, 512)
  token!: string;
}

export class AcceptInvitationDto extends TokenDto {
  @IsString()
  @Length(12, 256)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @Length(12, 256)
  password!: string;
}
