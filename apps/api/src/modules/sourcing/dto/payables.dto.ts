import { PayableStatus } from '@prisma/client';
import { PageQueryDto } from '../../../platform/api/paging.dto';
import { IsString, IsNotEmpty, IsNumber, IsOptional, MaxLength, IsEnum } from 'class-validator';

export class AdjustPayableDto {
  /** Signed EGP adjustment, two decimals at most; the result can never go below zero. */
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  /** Ignored: the adjusting actor is always the authenticated user. */
  @IsOptional()
  @IsString()
  actorId?: string;
}

export class MarkAsPaidDto {
  /** Operator's proof of payment (bank/cash voucher reference). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  paymentRef: string;
}

/** GET /sourcing/payables (admin ledger). */
export class PayableQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(PayableStatus)
  status?: PayableStatus;
}
