import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateGuidanceSessionDto {
  @IsOptional()
  @IsString()
  customerId?: string;
}

export class SendGuidanceMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
