import { OrderStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../platform/api/paging.dto';

/** GET /admin/orders */
export class AdminOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** Order number, customer name or phone fragment. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}
