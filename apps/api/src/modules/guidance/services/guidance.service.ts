import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AiClient } from '../../../platform/ai';
import { CreateGuidanceSessionDto, SendGuidanceMessageDto } from '../dto/guidance.dto';
import { GuidanceSessionStatus, GuidanceMessageRole, Prisma } from '@prisma/client';

@Injectable()
export class GuidanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClient,
  ) {}

  async createSession(dto: CreateGuidanceSessionDto) {
    // Check if customer exists in care profiles to use as context
    let profile = await this.prisma.customerCareProfile.findUnique({
      where: { customerId: dto.customerId },
      include: { concerns: { include: { concern: true } } },
    });

    if (!profile) {
      // Create empty profile if none exists so we can at least associate it
      profile = await this.prisma.customerCareProfile.create({
        data: { customerId: dto.customerId },
        include: { concerns: { include: { concern: true } } },
      });
    }

    const session = await this.prisma.guidanceSession.create({
      data: {
        customerId: dto.customerId,
        status: GuidanceSessionStatus.active,
      },
    });

    return session;
  }

  async getSession(sessionId: string) {
    const session = await this.prisma.guidanceSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new NotFoundException('Guidance session not found');
    return session;
  }

  async sendMessage(sessionId: string, dto: SendGuidanceMessageDto) {
    const session = await this.getSession(sessionId);

    // Save user message
    await this.prisma.guidanceMessage.create({
      data: {
        sessionId: session.id,
        role: GuidanceMessageRole.user,
        content: dto.content,
      },
    });

    // Fetch full history & profile for AI
    const history = await this.prisma.guidanceMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });

    const profile = await this.prisma.customerCareProfile.findUnique({
      where: { customerId: session.customerId },
      include: { concerns: { include: { concern: true } } },
    });

    const recommendationInput = {
      customerId: session.customerId,
      profile: {
        skinType: profile?.skinType ?? null,
        sensitivities: profile?.sensitivities ?? null,
        concerns: profile?.concerns.map(c => c.concern.name) ?? [],
      },
      chatHistory: history.map(h => ({
        role: h.role as 'user' | 'assistant' | 'system',
        content: h.content,
      })),
    };

    let result;
    try {
      result = await this.aiClient.recommendRoutine(recommendationInput, sessionId);
    } catch (err) {
      // Return a system fallback message if AI is down
      const fallbackMsg = await this.prisma.guidanceMessage.create({
        data: {
          sessionId: session.id,
          role: GuidanceMessageRole.system,
          content: 'Sorry, I am currently unavailable to provide recommendations.',
        },
      });
      return fallbackMsg;
    }

    // Save assistant response
    const assistantMsg = await this.prisma.guidanceMessage.create({
      data: {
        sessionId: session.id,
        role: GuidanceMessageRole.assistant,
        content: result.message,
        proposal: result.proposal as unknown as Prisma.InputJsonValue,
      },
    });

    return assistantMsg;
  }
}
