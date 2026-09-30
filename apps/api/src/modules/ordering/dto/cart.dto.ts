import { IsString, IsInt, Min } from 'class-validator';

export class AddToCartDto {
  @IsString()
  sessionId: string;

  @IsString()
  skuId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class RemoveFromCartDto {
  @IsString()
  sessionId: string;

  @IsString()
  skuId: string;
}

export class UpdateCartItemQuantityDto {
  @IsString()
  sessionId: string;

  @IsString()
  skuId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

