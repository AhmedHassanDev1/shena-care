import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class AdjustPayableDto {
  @IsNumber()
  amount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class MarkAsPaidDto {
  @IsString()
  @IsNotEmpty()
  paymentRef: string;
}
