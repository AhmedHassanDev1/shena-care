import { Body, Controller, ForbiddenException, Get, Headers, Param, ParseUUIDPipe, Post, Query, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { FlushRfqBatchDto, getSourcingMode, ListRfqsQueryDto, RespondToRfqDto, RfqService } from '../../../modules/sourcing/public';
import { CatalogService } from '../../../modules/catalog/public';
import { page } from '../../../platform/api/paging.dto';

type RequestUser = { id: string; roles?: string[]; supplierId?: string | null };

const HEARTBEAT_MS = 25_000;
const POLL_MS = 2_000;

/**
 * BROADCAST_ON_DEMAND supplier workspace API (GLO-283). Suppliers see only RFQs sent to their own account, never customer
 * data, other suppliers' answers or prices. Every quantity a supplier sees is the server's current remaining demand.
 */
@Controller('rfq')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class RfqController {
  constructor(private readonly rfq: RfqService, private readonly catalog: CatalogService) {}

  private supplierOf(user: RequestUser): string {
    if (!user.roles?.includes('SUPPLIER') || !user.supplierId) throw new ForbiddenException('A linked supplier account is required');
    return user.supplierId;
  }

  @Get('mode')
  @Roles('ADMIN', 'HUB_OPERATOR', 'SUPPLIER')
  mode() {
    return { mode: getSourcingMode() };
  }

  /** Authorized early flush (audited, reason required). Normal 3-hour checkpoints run on the scheduler. */
  @Post('batches')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('sourcing.manage')
  flush(@CurrentUser() user: RequestUser, @Body() dto: FlushRfqBatchDto) {
    return this.rfq.flushRfqBatch(user.id, { early: true, reason: dto.reason, includeClosedSuppliers: dto.includeClosedSuppliers });
  }

  /** Staff trigger of the recovery pass (timeouts, expedited audience extension, Admin escalation). */
  @Post('maintenance')
  @Roles('ADMIN')
  @RequirePermissions('sourcing.manage')
  async maintenance() {
    return { evaluated: await this.rfq.runMaintenance() };
  }

  @Get('staff')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('sourcing.manage')
  listForStaff(@Query() query: ListRfqsQueryDto) {
    return this.rfq.listForStaff(page(query));
  }

  @Get('staff/:id')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('sourcing.manage')
  async staffDetail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.rfq.getStaffDetail(id);
    // Staff-only read: name each demand line (product, variant, code) so people can act on it.
    const labels = await this.catalog.getSkuLabels(detail.lines.map((line) => line.skuId));
    return { ...detail, lines: detail.lines.map((line) => ({ ...line, sku: labels.get(line.skuId) ?? null })) };
  }

  @Get('mine')
  @Roles('SUPPLIER')
  listMine(@CurrentUser() user: RequestUser) {
    return this.rfq.listForSupplier(this.supplierOf(user));
  }

  /**
   * Server-sent events for the caller's own supplier only. Resume with `after=<seq>` or Last-Event-ID; the client must also
   * re-read the snapshot on every (re)connect, because the snapshot — not this stream — is the source of truth.
   */
  @Get('stream')
  @Roles('SUPPLIER')
  @Sse()
  stream(@CurrentUser() user: RequestUser, @Query('after') after?: string, @Headers('last-event-id') lastEventId?: string): Observable<MessageEvent> {
    const supplierId = this.supplierOf(user);
    const resume = lastEventId ?? after;
    return new Observable<MessageEvent>(subscriber => {
      let cursor: bigint | null = resume && /^\d{1,18}$/.test(resume) ? BigInt(resume) : null;
      const sent = new Set<string>();
      let busy = false;
      let closed = false;
      let primed = false;
      const pump = async () => {
        if (busy || closed) return;
        busy = true;
        try {
          if (cursor === null) {
            cursor = await this.rfq.currentCursor();
            subscriber.next({ type: 'ready', data: { cursor: cursor.toString() } });
          }
          const startedAt = cursor;
          for (const event of await this.rfq.eventsForSupplier(supplierId, cursor)) {
            if (sent.has(event.seq)) continue;
            sent.add(event.seq);
            // The look-behind window re-reads recent rows for late commits; on (re)connect everything at or below the
            // starting cursor was already handled by the client (and the snapshot it loads on connect), so it is not replayed.
            if (!primed && BigInt(event.seq) <= startedAt) continue;
            if (BigInt(event.seq) > cursor) cursor = BigInt(event.seq);
            subscriber.next({ id: event.seq, type: event.type, data: { seq: event.seq, rfqId: event.rfqId, type: event.type, at: event.createdAt, ...(event.payload as object) } });
          }
          primed = true;
          if (sent.size > 5000) for (const seq of [...sent].slice(0, 2500)) sent.delete(seq);
        } catch {
          // The next poll retries; a persistent failure surfaces to the client as a dropped stream and a snapshot reload.
        } finally {
          busy = false;
        }
      };
      const poll = setInterval(pump, POLL_MS);
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping', data: { at: new Date().toISOString() } }), HEARTBEAT_MS);
      this.rfq.bus.on('wake', pump);
      void pump();
      return () => {
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        this.rfq.bus.off('wake', pump);
      };
    });
  }

  @Get(':id')
  @Roles('SUPPLIER')
  snapshot(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers('purpose') purpose?: string, @Headers('sec-purpose') secPurpose?: string) {
    const prefetch = purpose === 'prefetch' || secPurpose === 'prefetch';
    return this.rfq.getSupplierSnapshot(this.supplierOf(user), id, { markOpened: !prefetch });
  }

  @Post(':id/responses')
  @Roles('SUPPLIER')
  respond(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondToRfqDto) {
    return this.rfq.respond(this.supplierOf(user), id, dto, user.id);
  }
}
