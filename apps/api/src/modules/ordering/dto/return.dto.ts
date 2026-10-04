import { IsEnum, IsString, IsArray, IsOptional, IsInt, Min } from 'class-validator';

export enum ReturnReason {
  WRONG_ITEM = 'WRONG_ITEM',
  MISSING_ITEM = 'MISSING_ITEM',
  DAMAGED_OR_LEAKING = 'DAMAGED_OR_LEAKING',
  DEFECT_OR_QUALITY_CONCERN = 'DEFECT_OR_QUALITY_CONCERN',
  CHANGE_OF_MIND = 'CHANGE_OF_MIND',
  DELIVERY_PROBLEM = 'DELIVERY_PROBLEM',
  POSSIBLE_ADVERSE_EVENT = 'POSSIBLE_ADVERSE_EVENT',
  OTHER = 'OTHER'
}

export class ReturnEligibilityProjectionDto {
  orderItemId: string;
  isEligible: boolean;
  normalWindowEndsAt: Date | null;
  defectWindowEndsAt: Date | null;
  allowedReasons: ReturnReason[];
  policyReviewRequired: boolean;
  conditionReviewRequired: boolean;
}

export class SubmitReturnDto {
  @IsEnum(ReturnReason)
  reasonCode: ReturnReason;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaRefs?: string[];

  @IsOptional()
  @IsString()
  batchOrLot?: string;

  @IsOptional()
  @IsString()
  expiry?: string;
}
