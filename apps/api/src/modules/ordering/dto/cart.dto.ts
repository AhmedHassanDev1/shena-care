import { IsString, IsInt, Min, IsOptional } from 'class-validator';

export class AddToCartDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  skuId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class RemoveFromCartDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  skuId: string;
}

export class UpdateCartItemQuantityDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  skuId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

