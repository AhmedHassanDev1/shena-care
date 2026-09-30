import { IsString, IsNotEmpty } from 'class-validator';

export class CreateGuidanceSessionDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;
}

export class SendGuidanceMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
