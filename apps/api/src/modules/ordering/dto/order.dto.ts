import { IsString, IsPhoneNumber, IsNotEmpty, IsOptional } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsPhoneNumber()
  customerPhone: string;

  @IsString()
  @IsNotEmpty()
  shippingAddress: string;

  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
