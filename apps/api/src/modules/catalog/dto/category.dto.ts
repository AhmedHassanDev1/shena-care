import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must consist of lowercase alphanumeric characters and single hyphens',
  })
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must consist of lowercase alphanumeric characters and single hyphens',
  })
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
