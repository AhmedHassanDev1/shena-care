import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
  IsUrl,
  IsObject,
  IsUUID,
} from 'class-validator';
import { MediaType, MediaOriginType, MediaRole } from '@prisma/client';

export class CreateProductMediaDto {
  @IsEnum(MediaType)
  @IsNotEmpty()
  type: MediaType;

  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
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

  @IsEnum(MediaRole)
  @IsOptional()
  role?: MediaRole;

  @IsUUID()
  @IsOptional()
  assetId?: string;

  @IsOptional()
  @IsObject()
  generationMetadata?: Record<string, unknown>;
}

export class UpdateProductMediaDto {
  @IsEnum(MediaType)
  @IsOptional()
  type?: MediaType;

  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
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
  @IsObject()
  generationMetadata?: Record<string, unknown>;
}
