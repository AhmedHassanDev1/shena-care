import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReturnReceipt } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { ReconciliationService } from '../../ordering/public';
import { CatalogService } from '../../catalog/public';
import { CorrectInspectionDto, InspectReturnDto } from '../dto/hub-desk.dto';
import { FulfillmentActor, FulfillmentService } from './fulfillment.service';

const OPEN_RETURN_STATUSES = ['approved', 'in_transit', 'received'] as const;
const ACCEPTING_STATUSES = ['approved', 'in_transit'];

type Disposition = 'RETURN_TO_SUPPLIER' | 'WRITE_OFF' | 'QUARANTINE';
export type ReturnRejectCode = 'PRODUCT_IDENTITY_REVIEW_REQUIRED' | 'PRODUCT_IDENTITY_AMBIGUOUS' | 'PRODUCT_IDENTITY_MISMATCH';

/**
 * Hub Returns (GLO-315): the physical side of a customer return. The employee identifies the returned unit, inspects it and records
 * what arrived and what happens to it (back to the supplier only when sealed and intact, otherwise written off, or held when it is a
 * safety report). This never decides or moves a refund: the refund stays an Ordering/admin decision with its own proof, and the
 * response only shows its state. Inspections are append-only; a correction is a new row that supersedes the old one, with a reason.
 */
@Injectable()
export class HubReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
    private readonly reconciliation: ReconciliationService,
    private readonly catalog: CatalogService,
  ) {}

  async list(locationId: string, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const shipments = await this.prisma.shipment.findMany({ where: { locationId }, select: { orderId: true } });
    const cases = (await this.reconciliation.listReturnCases(shipments.map(s => s.orderId), [...OPEN_RETURN_STATUSES])).filter(c => c.requiresPhysicalReturn);
    return { items: await this.present(cases) };
  }

  private async present(cases: Awaited<ReturnType<ReconciliationService['listReturnCases']>>) {
    if (!cases.length) return [];
    const rows = await this.prisma.returnReceipt.findMany({ where: { resolutionId: { in: cases.map(c => c.resolutionId) } }, orderBy: { receivedAt: 'asc' } });
    const superseded = new Set(rows.map(r => r.supersedesId).filter((id): id is string => !!id));
    const labels = await this.catalog.getSkuLabels(cases.flatMap(c => c.items.map(i => i.skuId)));
    const view = (r: ReturnReceipt) => ({
      id: r.id, quantity: r.quantity, result: r.inspectionResult, disposition: r.disposition, lotNumber: r.lotNumber,
      expiryDate: r.expiryDate ? r.expiryDate.toISOString().slice(0, 10) : null, note: r.note, identityMethod: r.identityMethod,
      supersedesId: r.supersedesId, correctionReason: r.correctionReason, actorId: r.actorId, receivedAt: r.receivedAt,
    });
    return cases.map(c => {
      const mine = rows.filter(r => r.resolutionId === c.resolutionId);
      const lines = c.items.map(item => {
        const label = labels.get(item.skuId);
        const history = mine.filter(r => r.orderItemId === item.orderItemId);
        const current = history.find(r => !superseded.has(r.id)) ?? null;
        return {
          ...item, productName: label?.productName ?? item.productName, variantName: label?.variantName ?? item.variantName,
          skuCode: label?.skuCode ?? item.skuCode, barcode: label?.barcode ?? null, imageUrl: label?.imageUrl ?? null,
          inspection: current ? view(current) : null, history: history.map(view),
        };
      });
      return { ...c, lines, allInspected: lines.every(line => !!line.inspection) };
    });
  }

  private async load(locationId: string, resolutionId: string, actor: FulfillmentActor) {
    await this.fulfillment.assertDeskLocation(locationId, actor);
    const found = await this.reconciliation.getReturnCase(resolutionId);
    if (!found) throw new NotFoundException('Return not found');
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId: found.orderId }, select: { locationId: true } });
    if (!shipment || shipment.locationId !== locationId) throw new NotFoundException('Return not found at this Hub');
    if (!found.requiresPhysicalReturn) throw new ConflictException({ code: 'NO_PHYSICAL_RETURN', message: 'This return does not involve goods coming back' });
    return found;
  }

  private async view(locationId: string, resolutionId: string, actor: FulfillmentActor) {
    const found = await this.load(locationId, resolutionId, actor);
    return (await this.present([found]))[0];
  }

  private disposition(result: InspectReturnDto['result'], requested: Disposition | undefined, safetyReport: boolean): Disposition {
    if (safetyReport) {
      if (requested && requested !== 'QUARANTINE') throw new BadRequestException({ code: 'SAFETY_REPORT_QUARANTINE', message: 'Goods from a safety report are held (quarantine), not returned or written off' });
      return 'QUARANTINE';
    }
    if (requested === 'RETURN_TO_SUPPLIER' && result !== 'SEALED_INTACT') {
      throw new BadRequestException({ code: 'ONLY_SEALED_GOES_BACK', message: 'Only sealed, intact goods go back to the supplier; anything else is written off or held' });
    }
    return requested ?? (result === 'SEALED_INTACT' ? 'RETURN_TO_SUPPLIER' : 'WRITE_OFF');
  }

  private note(kind: string, r: { quantity: number; inspectionResult: string; disposition: string; lotNumber: string | null }, extra?: string) {
    return `Hub ${kind}: ${r.quantity}× ${r.inspectionResult} → ${r.disposition}${r.lotNumber ? ` (lot ${r.lotNumber})` : ''}${extra ? ` — ${extra}` : ''}`.slice(0, 500);
  }

  /** Records the physical inspection of one returned line. When every line is inspected the return is marked received (never resolved or refunded). */
  async inspect(locationId: string, resolutionId: string, dto: InspectReturnDto, actor: FulfillmentActor) {
    const found = await this.load(locationId, resolutionId, actor);
    const replay = await this.prisma.returnReceipt.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (replay) {
      if (replay.resolutionId !== resolutionId || replay.orderItemId !== dto.orderItemId || replay.actorId !== actor.id) {
        throw new ConflictException('This inspection id was already used for something else');
      }
      await this.markReceivedIfComplete(locationId, resolutionId, actor);
      return { outcome: 'recorded' as const, replayed: true, case: await this.view(locationId, resolutionId, actor) };
    }
    if (!ACCEPTING_STATUSES.includes(found.status)) {
      throw new ConflictException({ code: 'RETURN_NOT_ACCEPTING', message: `This return is ${found.status}; correct an earlier inspection instead of adding a new one` });
    }
    const item = found.items.find(i => i.orderItemId === dto.orderItemId);
    if (!item) throw new BadRequestException('That line is not part of this return');
    if (dto.quantity > item.quantity) throw new BadRequestException(`At most ${item.quantity} of this line is part of the return`);

    // Identity of the physical unit: the returned product must be the one that was sold (reviewed barcode, alias, or audited manual check).
    const unit = await this.fulfillment.resolveUnitIdentity({
      barcodeScanned: dto.barcodeScanned, skuId: dto.barcodeScanned ? undefined : item.skuId, manualReason: dto.manualReason, manualChecks: dto.manualChecks,
    });
    const rejected = !unit.ok ? unit.code : unit.skuId !== item.skuId ? 'PRODUCT_IDENTITY_MISMATCH' : null;
    if (rejected) {
      await this.prisma.hubScanAttempt.create({ data: {
        locationId, context: 'return', orderId: found.orderId, resolutionId, clientScanId: dto.idempotencyKey, barcodeScanned: dto.barcodeScanned ?? null,
        skuId: unit.ok ? unit.skuId : null, outcomeCode: rejected, actorId: actor.id,
      } }).catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
      return { outcome: 'rejected' as const, code: rejected as ReturnRejectCode, case: await this.view(locationId, resolutionId, actor) };
    }
    const disposition = this.disposition(dto.result, dto.disposition, found.safetyReport);

    const created = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44082, hashtext(${resolutionId}))::text AS locked`;
      const rows = await tx.returnReceipt.findMany({ where: { resolutionId, orderItemId: dto.orderItemId } });
      if (rows.length) throw new ConflictException({ code: 'ALREADY_INSPECTED', message: 'This line was already inspected; correct that inspection instead' });
      const row = await tx.returnReceipt.create({ data: {
        locationId, resolutionId, orderId: found.orderId, orderItemId: dto.orderItemId, skuId: item.skuId, quantity: dto.quantity,
        identityMethod: unit.ok ? unit.method : 'manual', barcodeScanned: dto.barcodeScanned ?? null, inspectionResult: dto.result, disposition,
        lotNumber: dto.lotNumber ?? null, expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null, note: dto.note ?? null,
        idempotencyKey: dto.idempotencyKey, actorId: actor.id,
      } });
      await this.reconciliation.recordResolutionNote(tx, resolutionId, actor.id, this.note('inspection', row, dto.note));
      return row;
    }, { timeout: 30000 });
    void created;
    await this.markReceivedIfComplete(locationId, resolutionId, actor);
    return { outcome: 'recorded' as const, replayed: false, case: await this.view(locationId, resolutionId, actor) };
  }

  /** Corrects a recorded inspection by appending a superseding row; the previous one and the reason stay in the history. */
  async correct(locationId: string, resolutionId: string, inspectionId: string, dto: CorrectInspectionDto, actor: FulfillmentActor) {
    const found = await this.load(locationId, resolutionId, actor);
    const replay = await this.prisma.returnReceipt.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (replay) {
      if (replay.supersedesId !== inspectionId || replay.actorId !== actor.id) throw new ConflictException('This correction id was already used for something else');
      return { outcome: 'corrected' as const, replayed: true, case: await this.view(locationId, resolutionId, actor) };
    }
    if (!['approved', 'in_transit', 'received'].includes(found.status)) {
      throw new ConflictException({ code: 'RETURN_CLOSED', message: `This return is ${found.status}; it can no longer be corrected here` });
    }
    const old = await this.prisma.returnReceipt.findUnique({ where: { id: inspectionId }, include: { correction: { select: { id: true } } } });
    if (!old || old.resolutionId !== resolutionId) throw new NotFoundException('Inspection not found');
    if (old.correction) throw new ConflictException({ code: 'ALREADY_CORRECTED', message: 'This inspection was already corrected; correct the latest one' });
    const item = found.items.find(i => i.orderItemId === old.orderItemId);
    if (!item) throw new BadRequestException('That line is not part of this return');
    if (dto.orderItemId !== old.orderItemId) throw new BadRequestException('A correction keeps the same line');
    if (dto.quantity > item.quantity) throw new BadRequestException(`At most ${item.quantity} of this line is part of the return`);
    const disposition = this.disposition(dto.result, dto.disposition, found.safetyReport);

    const created = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(44082, hashtext(${resolutionId}))::text AS locked`;
      const row = await tx.returnReceipt.create({ data: {
        locationId, resolutionId, orderId: old.orderId, orderItemId: old.orderItemId, skuId: old.skuId, quantity: dto.quantity,
        identityMethod: old.identityMethod, barcodeScanned: old.barcodeScanned, inspectionResult: dto.result, disposition,
        lotNumber: dto.lotNumber ?? null, expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null, note: dto.note ?? null,
        supersedesId: old.id, correctionReason: dto.reason.trim(), idempotencyKey: dto.idempotencyKey, actorId: actor.id,
      } });
      await this.reconciliation.recordResolutionNote(tx, resolutionId, actor.id, this.note('inspection corrected', row, dto.reason.trim()));
      return row;
    }, { timeout: 30000 }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ code: 'ALREADY_CORRECTED', message: 'This inspection was corrected concurrently' });
      throw error;
    });
    void created;
    return { outcome: 'corrected' as const, replayed: false, case: await this.view(locationId, resolutionId, actor) };
  }

  /** Physical receipt is complete when every line has a current inspection; only then does the return move to `received`. */
  private async markReceivedIfComplete(locationId: string, resolutionId: string, actor: FulfillmentActor) {
    const current = (await this.present([await this.load(locationId, resolutionId, actor)]))[0];
    if (current.allInspected && ACCEPTING_STATUSES.includes(current.status)) {
      await this.reconciliation.updateResolutionStatus(resolutionId, 'received', actor.id, 'All returned goods were physically received and inspected at the Hub');
    }
  }
}
