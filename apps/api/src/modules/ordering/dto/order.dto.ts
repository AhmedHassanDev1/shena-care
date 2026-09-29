import { IsString, IsPhoneNumber, IsNotEmpty } from 'class-validator';

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
}
