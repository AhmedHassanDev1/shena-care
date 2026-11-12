import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const RFQ_ANSWERS = ['FULL', 'PARTIAL', 'UNAVAILABLE'] as const;
export type RfqAnswerInput = (typeof RFQ_ANSWERS)[number];

export class RfqLineAnswerDto {
  @IsUUID()
  demandLineId: string;

  @IsIn(RFQ_ANSWERS)
  answer: RfqAnswerInput;

  /** PARTIAL only: units the supplier commits to now (1 .. seen quantity - 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  /** The version of the line the supplier looked at. A changed version means the answer is stale and is refused. */
  @IsInt()
  @Min(1)
  basedOnVersion: number;

  /** The requested quantity the supplier saw. FULL/PARTIAL are refused unless it still equals the live remaining demand. */
  @IsOptional()
  @IsInt()
  @Min(0)
  seenQuantity?: number;
}

export class RespondToRfqDto {
  /** One key per submit intent; a retry with the same key replays the stored outcome instead of awarding twice. */
  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RfqLineAnswerDto)
  lines: RfqLineAnswerDto[];
}

export class OfflineRfqLineDto {
  @IsUUID()
  demandLineId: string;

  @IsIn(['FULL', 'PARTIAL', 'REJECT'])
  answer: 'FULL' | 'PARTIAL' | 'REJECT';

  /** Actual quantity the contacted supplier confirmed; allocation is capped at uncovered demand. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  availableQuantity?: number;
}

export class RecordOfflineRfqResponseDto {
  @IsUUID()
  supplierId: string;

  @IsIn(['PHONE', 'WHATSAPP'])
  confirmationSource: 'PHONE' | 'WHATSAPP';

  @IsISO8601({ strict: true })
  confirmedAt: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OfflineRfqLineDto)
  lines: OfflineRfqLineDto[];
}

export class FlushRfqBatchDto {
  /** Required: an early flush is an audited exception to the checkpoint schedule. */
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;

  /** Also send to suppliers that are currently outside their working window. */
  @IsOptional()
  @IsBoolean()
  includeClosedSuppliers?: boolean;
}

export class ListRfqsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}
