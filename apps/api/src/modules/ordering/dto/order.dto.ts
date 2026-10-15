import { IsString, IsNotEmpty, IsOptional, Matches, IsNumber, IsIn, Min, Max, IsInt, IsUUID, MaxLength, Equals } from 'class-validator';
import { CONFIRMED_PIN_SOURCES } from '../services/service-area';

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

  /** Customer-placed and confirmed delivery pin (GLO-231): required, never defaulted by the server. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsString()
  @IsIn([...CONFIRMED_PIN_SOURCES])
  locationSource: string;

  @Equals(true, { message: 'The customer must confirm the delivery pin' })
  locationConfirmed: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  @IsUUID()
  quoteVersion: string;

  @IsInt()
  @Min(0)
  cartRevision: number;

  @IsString()
  @IsOptional()
  couponCode?: string;

  /** COD by default. CARD / MOBILE_WALLET only when a real provider is connected (GLO-241). */
  @IsOptional()
  @IsIn(['COD', 'CARD', 'MOBILE_WALLET'])
  paymentMethod?: 'COD' | 'CARD' | 'MOBILE_WALLET';

  /** Wallet/product subtype, e.g. 'vodafone_cash'; must match a connected provider. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  paymentProvider?: string;
}

export class CheckoutQuoteRequestDto {
  @IsString()
  @IsNotEmpty()
  governorate: string;

  @IsString()
  @IsNotEmpty()
  area: string;

  @IsString()
  @IsOptional()
  couponCode?: string;
}

/** Operator pin for an order placed before pins were mandatory (GLO-231); never overwrites a customer pin. */
export class CorrectDeliveryLocationDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** Append-only operator instruction; never replaces the customer's confirmed pin (RT08). */
export class AddDeliveryInstructionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;

  @IsIn(['ADDRESS_CLARIFICATION', 'PIN_CORRECTION', 'CUSTOMER_REQUEST', 'ACCESS_INSTRUCTIONS'])
  reason: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;
}
