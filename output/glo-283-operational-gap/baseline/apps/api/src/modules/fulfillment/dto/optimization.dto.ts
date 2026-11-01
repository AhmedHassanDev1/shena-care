import {
  IsArray,
  IsOptional,
  ValidateNested,
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ApplyOptimizationStopDto {
  @IsString()
  @IsNotEmpty()
  shipmentId: string;

  @IsInt()
  @Min(1)
  sequence: number;
}

export class OptimizationOptionsDto {
  /**
   * If true, route starts and ends at the Hub (closed loop).
   * If false, route starts at the Hub, optimizes intermediate stops, and ends at a fixed final destination.
   * Default: false (open delivery run).
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  roundtrip?: boolean;

  /**
   * For open routes (roundtrip=false), specify which stop ID serves as the fixed final destination.
   * If omitted, defaults to the last stop currently sequenced in the batch.
   */
  @IsOptional()
  @IsString()
  fixedFinalStopId?: string;
}

export class ApplyOptimizationDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  roundtrip?: boolean;

  @IsOptional()
  @IsString()
  fixedFinalStopId?: string;

  /**
   * Opaque token returned during preview. If provided, the optimization apply
   * verifies that the batch has not been modified since the preview was computed.
   */
  @IsOptional()
  @IsString()
  previewToken?: string;

  /**
   * ISO timestamp of batch.updatedAt observed during preview.
   */
  @IsOptional()
  @IsString()
  expectedBatchUpdatedAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyOptimizationStopDto)
  stops?: ApplyOptimizationStopDto[];
}
