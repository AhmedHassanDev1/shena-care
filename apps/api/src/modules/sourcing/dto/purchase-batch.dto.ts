import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PurchaseCostDto } from './buy-list.dto';

/** Staff cut the batch now instead of waiting for the next scheduled cutoff. One key = one batch, so a retry never cuts twice. */
export class CutPurchaseBatchDto {
  @IsUUID()
  idempotencyKey: string;
}

/** Marks the batch as ordered outside the system. Nothing is sent to any supplier by this call. */
export class SendPurchaseBatchDto {
  @IsOptional()
  @IsDateString()
  expectedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdatePurchaseBatchDto {
  /** `null` clears the expected arrival. */
  @IsOptional()
  @IsDateString()
  expectedAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

/** Units physically in hand for one line. A retry with the same key changes nothing. */
export class ReceivePurchaseBatchLineDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity: number;

  @IsUUID()
  idempotencyKey: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseCostDto)
  cost?: PurchaseCostDto;
}

export class ResolvePurchaseBatchLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdatePurchaseBatchSettingsDto {
  @IsInt()
  @Min(15)
  @Max(1440)
  intervalMinutes: number;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must look like 09:00' })
  startTime: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  timeZone: string;

  /** The settings version the editor loaded; a different current version means someone else saved first. */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
