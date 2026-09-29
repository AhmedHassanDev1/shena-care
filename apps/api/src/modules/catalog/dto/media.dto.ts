import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { MediaType, MediaOriginType } from '@prisma/client';

export class CreateProductMediaDto {
  @IsEnum(MediaType)
  @IsNotEmpty()
  type: MediaType;

  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  altText?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @IsEnum(MediaOriginType)
  @IsOptional()
  originType?: MediaOriginType;

  @IsOptional()
  generationMetadata?: Record<string, unknown>;
}

export class UpdateProductMediaDto {
  @IsEnum(MediaType)
  @IsOptional()
  type?: MediaType;

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  altText?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @IsEnum(MediaOriginType)
  @IsOptional()
  originType?: MediaOriginType;

  @IsOptional()
  generationMetadata?: Record<string, unknown>;
}
