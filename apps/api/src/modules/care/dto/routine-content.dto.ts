import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches,
  MaxLength, Min, ValidateNested,
} from 'class-validator';
import { CareArea } from '@prisma/client';

export const STEP_TIMINGS = ['AM', 'PM', 'AS_NEEDED'] as const;

/** Exactly one of the three identifiers; the server resolves it to one canonical SKU or refuses. */
export class ProductRefDto {
  @IsOptional() @IsUUID() skuId?: string;
  @IsOptional() @IsString() @MaxLength(64) sku?: string;
  @IsOptional() @IsString() @MaxLength(64) barcode?: string;
}

export class RoutineStepInputDto {
  @IsString() @IsNotEmpty() @MaxLength(80) title: string;
  @IsIn(STEP_TIMINGS) timing: (typeof STEP_TIMINGS)[number];
  @IsOptional() @IsString() @MaxLength(400) instructions?: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
  @ValidateNested() @Type(() => ProductRefDto) product: ProductRefDto;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => ProductRefDto) alternatives?: ProductRefDto[];
}

export class ReferenceDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsString() @Matches(/^https?:\/\/[^\s<>"']{3,480}$/i, { message: 'url must be an http(s) address' }) url: string;
}

/** Create / replace a Ready Routine template draft (Admin Routine Studio) — the same shape the JSON import normalizes into. */
export class StudioRoutineDto {
  @IsString() @IsNotEmpty() @MaxLength(120) title: string;
  @IsOptional() @IsString() @MaxLength(120) titleEn?: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string;
  @IsEnum(CareArea) careArea: CareArea;
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,59}$/) concernSlug: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ReferenceDto) references?: ReferenceDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RoutineStepInputDto) steps: RoutineStepInputDto[];
  /** Optimistic concurrency on edit: the version the editor loaded. */
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

/** A pasted/uploaded JSON document; its shape is validated by the explicit v1 parser, not by class-validator. */
export class RoutineImportDto {
  @IsObject() document: Record<string, unknown>;
  /** Required to create the draft; a preview never persists. */
  @IsOptional() @Equals(true) confirm?: true;
}

export class PersonalRoutineDto {
  @IsString() @IsNotEmpty() @MaxLength(120) title: string;
  @IsOptional() @IsEnum(CareArea) careArea?: CareArea;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RoutineStepInputDto) steps: RoutineStepInputDto[];
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

export class AiStepProposalDto {
  @IsString() @IsNotEmpty() @MaxLength(80) title: string;
  @IsIn(STEP_TIMINGS) timing: (typeof STEP_TIMINGS)[number];
  @IsUUID() skuId: string;
  /** Short reason the assistant gave; stored as a note, checked for unsupported claims, never trusted as a product fact. */
  @IsOptional() @IsString() @MaxLength(280) reason?: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
}

/** An assistant's routine proposal the customer reviewed and edited. Saving it requires explicit confirmation. */
export class SaveAiRoutineDto {
  @IsUUID() idempotencyKey: string;
  @Equals(true, { message: 'The customer must explicitly confirm before a proposal is saved' }) confirmed: true;
  @IsString() @IsNotEmpty() @MaxLength(120) title: string;
  @IsOptional() @IsEnum(CareArea) careArea?: CareArea;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => AiStepProposalDto) steps: AiStepProposalDto[];
}
