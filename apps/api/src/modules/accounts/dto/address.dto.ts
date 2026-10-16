import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsNumber,
  IsIn,
  Min,
  Max,
  IsBoolean,
  MaxLength,
} from 'class-validator';
export const ALLOWED_ADDRESS_LOCATION_SOURCES = ['map_pin', 'current_location'] as const;

export class CreateCustomerAddressDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  label?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
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
  @MaxLength(255)
  shippingAddress: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  notes?: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsString()
  @IsOptional()
  @IsIn([...ALLOWED_ADDRESS_LOCATION_SOURCES])
  locationSource?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateCustomerAddressDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  label?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(100)
  customerName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^(\+201|01)[0-9]{9}$/, { message: 'Must be a valid Egyptian mobile number' })
  customerPhone?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  governorate?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  area?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  shippingAddress?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  notes?: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsOptional()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsOptional()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsString()
  @IsOptional()
  @IsIn([...ALLOWED_ADDRESS_LOCATION_SOURCES])
  locationSource?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
