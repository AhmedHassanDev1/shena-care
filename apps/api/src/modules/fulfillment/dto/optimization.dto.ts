import { IsArray, IsOptional, ValidateNested, IsString, IsNotEmpty, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ApplyOptimizationStopDto {
  @IsString()
  @IsNotEmpty()
  shipmentId: string;

  @IsInt()
  @Min(1)
  sequence: number;
}

export class ApplyOptimizationDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyOptimizationStopDto)
  stops?: ApplyOptimizationStopDto[];
}
