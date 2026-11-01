import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '../../accounts/guards/auth.guard';
import { RolesGuard } from '../../accounts/guards/roles.guard';
import { Roles } from '../../accounts/decorators/roles.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { DomainEventsService } from '../../../platform/events/domain-events.service';

export class DomainEventQueryDto {
  @IsOptional() @IsIn(['pending', 'processing', 'delivered', 'failed', 'dead'])
  status?: 'pending' | 'processing' | 'delivered' | 'failed' | 'dead';

  @IsOptional() @IsUUID()
  aggregateId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  take?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;
}

/** Admin-only visibility and replay of durable cross-module events (GLO-236). */
@Controller('operations/events')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@RequirePermissions('order.manage')
export class DomainEventsController {
  constructor(private readonly events: DomainEventsService) {}

  @Get()
  list(@Query() query: DomainEventQueryDto) {
    return this.events.list(query);
  }

  /** Runs one delivery pass now (same path as the background poller). */
  @Post('dispatch')
  dispatch() {
    return this.events.dispatchPending({ limit: 200 });
  }

  /** Makes failed/dead rows due again; the consumer is idempotent, so replay is safe. */
  @Post('requeue')
  async requeueAll() {
    return { requeued: await this.events.requeue({}) };
  }

  @Post(':id/requeue')
  async requeue(@Param('id', ParseUUIDPipe) id: string) {
    return { requeued: await this.events.requeue({ id }) };
  }
}
