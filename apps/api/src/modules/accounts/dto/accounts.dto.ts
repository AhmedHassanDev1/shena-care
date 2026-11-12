import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  newPassword: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class SendOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  pendingIntent?: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;

  @IsUUID()
  @IsOptional()
  guestId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;
}

/** Editable personal details a signed-in customer can update on their profile. */
export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toLowerCase();
    return trimmed === '' ? null : trimmed;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;
}
