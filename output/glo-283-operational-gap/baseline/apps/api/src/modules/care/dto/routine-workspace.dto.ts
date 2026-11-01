import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { CareAgeBand, CareArea, CareExperienceLevel, RoutineTier, SkinType } from '@prisma/client';

const TRI_STATE = ['YES', 'NO', 'UNKNOWN'] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Safety answers, each YES | NO | UNKNOWN (§8-ب). Never free text. */
export class SafetyAnswersDto {
  @IsOptional() @IsIn(TRI_STATE) pregnant?: (typeof TRI_STATE)[number];
  @IsOptional() @IsIn(TRI_STATE) breastfeeding?: (typeof TRI_STATE)[number];
  @IsOptional() @IsIn(TRI_STATE) prescriptionTopical?: (typeof TRI_STATE)[number];
  @IsOptional() @IsIn(TRI_STATE) oralRetinoid?: (typeof TRI_STATE)[number];
  @IsOptional() @IsIn(TRI_STATE) fragranceSensitive?: (typeof TRI_STATE)[number];
}

/** Builder answers shared by start and update. */
class DraftAnswersDto {
  @IsOptional() @IsEnum(CareArea) careArea?: CareArea;
  @IsOptional() @IsString() @MaxLength(60) @Matches(SLUG) primaryConcern?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @Matches(SLUG, { each: true }) secondaryGoals?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(3) severity?: number;
  @IsOptional() @IsEnum(SkinType) skinType?: SkinType;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) budget?: number;
  @IsOptional() @IsEnum(RoutineTier) tier?: RoutineTier;
  @IsOptional() @IsEnum(CareAgeBand) ageBand?: CareAgeBand;
  @IsOptional() @IsEnum(CareExperienceLevel) experienceLevel?: CareExperienceLevel;
  @IsOptional() @IsBoolean() fragranceFree?: boolean;
}

export class StartRoutineDraftDto extends DraftAnswersDto {}

export class UpdateRoutineDraftDto extends DraftAnswersDto {
  /** Optimistic concurrency: the draft version the client last saw. */
  @IsInt() @Min(1) version!: number;

  /** Health answers are stored only with explicit consent to this notice version (§10-أ). */
  @IsOptional() @ValidateNested() @Type(() => SafetyAnswersDto) safety?: SafetyAnswersDto;
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[a-z0-9.-]+$/) consentVersion?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) allergyIngredientIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(SLUG, { each: true }) ownedRoleKeys?: string[];
}

export const PROPOSAL_ACTIONS = ['SWAP_ITEM', 'SET_OWNED', 'REMOVE_OPTIONAL', 'RESTORE_OPTIONAL', 'SET_TIER', 'SET_BUDGET', 'ACCEPT_UPGRADE'] as const;
export type ProposalActionType = (typeof PROPOSAL_ACTIONS)[number];

/** One edit of the proposal; the server applies it to the draft and recomputes (§5.4). */
export class ProposalActionDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(PROPOSAL_ACTIONS) action!: ProposalActionType;
  @IsOptional() @IsString() @MaxLength(40) @Matches(SLUG) roleKey?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsBoolean() owned?: boolean;
  @IsOptional() @IsEnum(RoutineTier) tier?: RoutineTier;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) budget?: number;
}

export class SaveProposalDto {
  /** Activate on save when the care-area slot is free and nothing conflicts (default true). */
  @IsOptional() @IsBoolean() activate?: boolean;
}

export class ActivateRoutineDto {
  /** Roles to take from another active routine instead of buying again (§5.6 role reuse). */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(SLUG, { each: true }) shareRoleKeys?: string[];
}

export const ROUTINE_STATUS_ACTIONS = ['DEACTIVATE', 'STOP', 'COMPLETE'] as const;
export class RoutineStatusDto {
  @IsIn(ROUTINE_STATUS_ACTIONS) action!: (typeof ROUTINE_STATUS_ACTIONS)[number];
  @IsOptional() @IsIn(['CUSTOMER', 'SAFETY_IRRITATION', 'SAFETY_WORSENING']) reason?: string;
}

export class SwapRoutineItemDto {
  @IsInt() @Min(1) version!: number;
  @IsUUID() productId!: string;
}

export class RoutineCartDto {
  @IsOptional() @IsIn(['IMMEDIATE', 'ALL']) phase?: 'IMMEDIATE' | 'ALL';
}

export class EligibilityDto {
  @IsUUID() productId!: string;
  @IsString() @Matches(SLUG) roleKey!: string;
  @IsEnum(RoutineTier) tier!: RoutineTier;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(SLUG, { each: true }) concernSlugs!: string[];
  @IsOptional() @IsArray() @IsEnum(SkinType, { each: true }) suitableSkinTypes?: SkinType[];
  @IsOptional() @IsIn(['APPROVED', 'REJECTED', 'PENDING']) reviewStatus?: 'APPROVED' | 'REJECTED' | 'PENDING';
}
