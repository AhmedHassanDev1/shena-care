import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateSupportCaseDto, UpdateSupportCaseDto } from '../dto/operations.dto';
import { OutboxService } from './outbox.service';

@Injectable()
export class SupportService {
  private readonly prisma = new PrismaClient();
  constructor(private readonly outbox: OutboxService) {}

  async createCase(dto: CreateSupportCaseDto) {
    const supportCase = await this.prisma.supportCase.create({
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category as any || 'other',
        priority: dto.priority as any || 'medium',
        customerId: dto.customerId,
        orderId: dto.orderId,
        supplierId: dto.supplierId,
      }
    });

    await this.outbox.enqueue('SUPPORT_CASE_CREATED', {
      caseId: supportCase.id,
      title: supportCase.title,
      priority: supportCase.priority
    });

    return supportCase;
  }

  async getCases(status?: string) {
    return this.prisma.supportCase.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' }
    });
  }

  async getCaseById(id: string, customerId?: string) {
    const c = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!c || (customerId && c.customerId !== customerId)) {
      throw new NotFoundException('Support case not found');
    }
    return c;
  }

  async updateCase(id: string, dto: UpdateSupportCaseDto, actorId: string) {
    const existing = await this.getCaseById(id);
    return this.prisma.supportCase.update({
      where: { id },
      data: {
        status: dto.status as any,
        internalNotes: dto.internalNotes,
        assigneeId: dto.assigneeId
      }
    });
  }
}
