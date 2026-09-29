import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../../catalog/public';
import { SourcingService } from '../../sourcing/public';
import { CreateIngestionJobDto, ApproveIngestionItemDto } from '../dto/ingestion.dto';
import { IngestionStatus } from '@prisma/client';

export interface IngestionJobDetail {
  id: string;
  supplierId: string;
  status: IngestionStatus;
  createdAt: Date;
  items: Array<{
    id: string;
    supplierSkuCode: string;
    name: string;
    brand: string;
    barcode: string | null;
    price: number;
    currency: string;
    status: IngestionStatus;
    matchedSkuId: string | null;
  }>;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly sourcingService: SourcingService,
  ) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  async createJob(dto: CreateIngestionJobDto): Promise<IngestionJobDetail> {
    if (!this.isUuid(dto.supplierId)) throw new BadRequestException('Invalid supplier ID');

    // Verify supplier exists
    const supplier = await this.sourcingService.getSupplier(dto.supplierId);
    if (!supplier) throw new NotFoundException('Supplier not found');

    const job = await this.prisma.ingestionJob.create({
      data: {
        supplierId: dto.supplierId,
        items: {
          create: dto.items.map((item) => ({
            supplierSkuCode: item.supplierSkuCode,
            name: item.name,
            brand: item.brand,
            barcode: item.barcode,
            price: item.price,
            currency: item.currency,
          })),
        },
      },
      include: { items: true },
    });

    // Fire-and-forget matching process
    this.processMatching(job.id).catch((err) => console.error('Matching failed:', err));

    return {
      ...job,
      items: job.items.map(item => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async getJob(jobId: string): Promise<IngestionJobDetail | null> {
    if (!this.isUuid(jobId)) return null;
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });

    if (!job) return null;

    return {
      ...job,
      items: job.items.map(item => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }

  async getJobs(): Promise<IngestionJobDetail[]> {
    const jobs = await this.prisma.ingestionJob.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });

    return jobs.map(job => ({
      ...job,
      items: job.items.map(item => ({
        ...item,
        price: item.price.toNumber(),
      })),
    }));
  }

  private async processMatching(jobId: string): Promise<void> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });

    if (!job) return;

    for (const item of job.items) {
      if (item.status !== IngestionStatus.pending) continue;

      let matchedSkuId: string | null = null;

      // 1. Barcode match
      if (item.barcode) {
        const sku = await this.catalogService.getSkuByBarcode(item.barcode);
        if (sku) {
          matchedSkuId = sku.id;
        }
      }

      // If no barcode match, manual review is needed.
      // (Future: NLP/Fuzzy match based on brand + name)

      const status = matchedSkuId ? IngestionStatus.approved : IngestionStatus.review_required;

      await this.prisma.ingestionItem.update({
        where: { id: item.id },
        data: { matchedSkuId, status },
      });
    }

    // Check if all items are approved/rejected, update job status
    await this.evaluateJobStatus(jobId);
  }

  async approveItem(itemId: string, dto: ApproveIngestionItemDto): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    if (item.job.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job');
    }

    if (!this.isUuid(dto.matchedSkuId)) throw new BadRequestException('Invalid SKU ID');
    
    // Verify SKU exists
    const isValid = await this.catalogService.validateSku(dto.matchedSkuId);
    if (!isValid) throw new NotFoundException('SKU not found in catalog or is inactive');

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: {
        matchedSkuId: dto.matchedSkuId,
        status: IngestionStatus.approved,
      },
    });

    await this.evaluateJobStatus(item.jobId);
  }

  async rejectItem(itemId: string): Promise<void> {
    const item = await this.prisma.ingestionItem.findUnique({
      where: { id: itemId },
      include: { job: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    if (item.job.status === IngestionStatus.published) {
      throw new BadRequestException('Cannot modify items of a published job');
    }

    await this.prisma.ingestionItem.update({
      where: { id: itemId },
      data: { status: IngestionStatus.rejected },
    });

    await this.evaluateJobStatus(item.jobId);
  }

  private async evaluateJobStatus(jobId: string): Promise<void> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });
    if (!job) return;

    const allProcessed = job.items.every(i => 
      i.status === IngestionStatus.approved || 
      i.status === IngestionStatus.rejected || 
      i.status === IngestionStatus.published
    );

    if (allProcessed && job.status !== IngestionStatus.published && job.status !== IngestionStatus.approved) {
      await this.prisma.ingestionJob.update({
        where: { id: jobId },
        data: { status: IngestionStatus.approved },
      });
    }
  }

  async publishJob(jobId: string): Promise<IngestionJobDetail> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });

    if (!job) throw new NotFoundException('Job not found');

    if (job.status === IngestionStatus.published) {
      throw new BadRequestException('Job is already published');
    }

    if (job.status !== IngestionStatus.approved) {
      throw new BadRequestException('Job is not fully approved yet. Resolve pending items first.');
    }

    const errors: string[] = [];

    // Publish approved items to Sourcing
    for (const item of job.items) {
      if (item.status === IngestionStatus.approved && item.matchedSkuId) {
        try {
          await this.sourcingService.createSupplierOffer({
            supplierId: job.supplierId,
            skuId: item.matchedSkuId,
            costPrice: item.price.toNumber(),
            currency: item.currency,
            isAvailable: true,
          });
          
          await this.prisma.ingestionItem.update({
            where: { id: item.id },
            data: { status: IngestionStatus.published },
          });
        } catch (e) {
          if (e instanceof ConflictException) {
            // Offer already exists, update it instead safely
            try {
              const offers = await this.sourcingService.getSupplierOffers({
                supplierId: job.supplierId,
                skuId: item.matchedSkuId,
              });
              if (offers.length > 0) {
                await this.sourcingService.updateSupplierOffer(offers[0].id, {
                  costPrice: item.price.toNumber(),
                  currency: item.currency,
                  isAvailable: true,
                });
                await this.prisma.ingestionItem.update({
                  where: { id: item.id },
                  data: { status: IngestionStatus.published },
                });
              }
            } catch (innerErr) {
              const errorMessage = innerErr instanceof Error ? innerErr.message : String(innerErr);
              errors.push(`Failed to update existing offer for item ${item.id}: ${errorMessage}`);
            }
          } else {
            const errorMessage = e instanceof Error ? e.message : String(e);
            errors.push(`Failed to create offer for item ${item.id}: ${errorMessage}`);
          }
        }
      }
    }

    if (errors.length > 0) {
      // Partial failure: state remains approved (or partially published)
      throw new BadRequestException({
        message: 'Partial publish failure',
        errors,
      });
    }

    const updatedJob = await this.prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: IngestionStatus.published },
      include: { items: true },
    });

    return {
      ...updatedJob,
      items: updatedJob.items.map(item => ({
        ...item,
        price: item.price.toNumber(),
      })),
    };
  }
}
