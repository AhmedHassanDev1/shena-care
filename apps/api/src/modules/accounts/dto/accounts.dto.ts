import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';

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
}
