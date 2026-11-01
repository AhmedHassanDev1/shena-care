import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class SupplyOrderParamsDto {
  @IsUUID()
  orderId: string;
}

export class AllocationParamsDto {
  @IsUUID()
  allocationId: string;
}

export class ConfirmSourceAllocationDto {
  @IsIn(['confirmed_full', 'confirmed_partial', 'unavailable', 'rejected', 'price_changed'])
  result: 'confirmed_full' | 'confirmed_partial' | 'unavailable' | 'rejected' | 'price_changed';

  @IsInt()
  @Min(0)
  confirmedQuantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  evidenceRef?: string;
}
