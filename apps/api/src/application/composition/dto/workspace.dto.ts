import { OrderStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../platform/api/paging.dto';

const VALID_ADMIN_ORDER_STATUSES = [...Object.values(OrderStatus), 'active', 'terminal'];

/** GET /admin/orders */
export class AdminOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(VALID_ADMIN_ORDER_STATUSES)
  status?: string;

  /** Order number, customer name or phone fragment. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}
