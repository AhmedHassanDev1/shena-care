import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsInt, Min, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { CareArea, RoutineTiming, RecommendationSource, SkinType } from '@prisma/client';

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
