import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsInt, Min, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { CareArea, RoutineTiming, RecommendationSource, SkinType, CareAgeBand, CareExperienceLevel } from '@prisma/client';

export enum HairType {
  straight = 'straight',
  wavy = 'wavy',
  curly = 'curly',
  coily = 'coily',
}

export enum ScalpType {
  normal = 'normal',
  dry = 'dry',
  oily = 'oily',
  sensitive = 'sensitive',
}

export enum CareFocus {
  skin = 'skin',
  hair = 'hair',
  both = 'both',
}

export enum SunExposure {
  low = 'low',
  moderate = 'moderate',
  high = 'high',
}

export enum PreferredTexture {
  gel = 'gel',
  cream = 'cream',
  lotion = 'lotion',
  fluid = 'fluid',
  rich_cream = 'rich_cream',
}

export class CreateConcernDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsEnum(CareArea)
  careArea: CareArea;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateRoutineDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(CareArea)
  careArea: CareArea;

  @IsBoolean()
  @IsOptional()
  isTemplate?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateRoutineStepRecommendationDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsEnum(RecommendationSource)
  @IsOptional()
  source?: RecommendationSource;
}

export class CreateRoutineStepDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  instructions?: string;

  @IsInt()
  @Min(0)
  stepOrder: number;

  @IsEnum(RoutineTiming)
  timing: RoutineTiming;

  @IsBoolean()
  @IsOptional()
  isOptional?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineStepRecommendationDto)
  @IsOptional()
  recommendations?: CreateRoutineStepRecommendationDto[];
}

export class CreateCustomerCareProfileConcernDto {
  @IsString()
  @IsNotEmpty()
  concernId: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  severity?: number;
}

export class CreateCustomerCareProfileDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsEnum(SkinType)
  @IsOptional()
  skinType?: SkinType;

  @IsEnum(HairType)
  @IsOptional()
  hairType?: HairType;

  @IsEnum(ScalpType)
  @IsOptional()
  scalpType?: ScalpType;

  @IsEnum(CareFocus)
  @IsOptional()
  primaryFocus?: CareFocus;

  @IsEnum(SunExposure)
  @IsOptional()
  sunExposure?: SunExposure;

  @IsEnum(PreferredTexture)
  @IsOptional()
  preferredTexture?: PreferredTexture;

  @IsEnum(CareAgeBand)
  @IsOptional()
  ageBand?: CareAgeBand;

  @IsEnum(CareExperienceLevel)
  @IsOptional()
  experienceLevel?: CareExperienceLevel;

  @IsBoolean()
  @IsOptional()
  fragranceFree?: boolean;

  @IsString()
  @IsOptional()
  sensitivities?: string;

  @IsOptional()
  budget?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerCareProfileConcernDto)
  @IsOptional()
  concerns?: CreateCustomerCareProfileConcernDto[];
}

export class UpdateCustomerCareProfileDto {
  @IsEnum(SkinType)
  @IsOptional()
  skinType?: SkinType;

  @IsEnum(HairType)
  @IsOptional()
  hairType?: HairType;

  @IsEnum(ScalpType)
  @IsOptional()
  scalpType?: ScalpType;

  @IsEnum(CareFocus)
  @IsOptional()
  primaryFocus?: CareFocus;

  @IsEnum(SunExposure)
  @IsOptional()
  sunExposure?: SunExposure;

  @IsEnum(PreferredTexture)
  @IsOptional()
  preferredTexture?: PreferredTexture;

  @IsEnum(CareAgeBand)
  @IsOptional()
  ageBand?: CareAgeBand;

  @IsEnum(CareExperienceLevel)
  @IsOptional()
  experienceLevel?: CareExperienceLevel;

  @IsBoolean()
  @IsOptional()
  fragranceFree?: boolean;

  @IsString()
  @IsOptional()
  sensitivities?: string;

  @IsOptional()
  budget?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  routineId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerCareProfileConcernDto)
  @IsOptional()
  concerns?: CreateCustomerCareProfileConcernDto[];
}
