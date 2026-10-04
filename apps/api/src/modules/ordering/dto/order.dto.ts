import { IsString, IsNotEmpty, IsOptional, Matches, IsNumber, IsIn, Min, Max, IsInt, IsUUID, MaxLength } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @Matches(/^(\+201|01)[0-9]{9}$/, { message: 'Must be a valid Egyptian mobile number' })
  customerPhone: string;

  @IsString()
  @IsNotEmpty()
  governorate: string;

  @IsString()
  @IsNotEmpty()
  area: string;

  @IsString()
  @IsNotEmpty()
  shippingAddress: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsString()
  @IsOptional()
  @IsIn(['map_pin', 'current_location', 'geocoded_address'])
  locationSource?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  @IsUUID()
  quoteVersion: string;

  @IsInt()
  @Min(0)
  cartRevision: number;
}

export class CheckoutQuoteRequestDto {
  @IsString()
  @IsNotEmpty()
  governorate: string;

  @IsString()
  @IsNotEmpty()
  area: string;
}
