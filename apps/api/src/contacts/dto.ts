import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ContactsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  tagId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  hasCrmLeadId?: 'true' | 'false';

  @IsOptional()
  @IsIn(['createdAt', 'lastInteractionAt', 'displayName'])
  sortBy: 'createdAt' | 'lastInteractionAt' | 'displayName' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  username?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @Length(3, 320)
  email?: string | null;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';

  @IsOptional()
  @IsIn(['ENABLED', 'DISABLED'])
  automationMode?: 'ENABLED' | 'DISABLED';

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class CreateTagDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;
}

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string | null;
}

export class AddTagDto {
  @IsString()
  tagId!: string;
}

export class BulkTagsDto {
  @IsArray()
  @IsString({ each: true })
  contactIds!: string[];

  @IsArray()
  @IsString({ each: true })
  tagIds!: string[];

  @IsBoolean()
  add!: boolean;
}

export class CreateCustomFieldDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,63}$/)
  key!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @IsIn(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT', 'MULTI_SELECT', 'JSON'])
  type!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

export class UpdateCustomFieldDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}
