import { Injectable, NotFoundException, BadRequestException, Logger, ServiceUnavailableException, BadGatewayException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { AiClient, AiClientError, AiErrorKind } from '../../../platform/ai';
import { CreateGuidanceSessionDto, SendGuidanceMessageDto } from '../dto/guidance.dto';
import { GuidanceSessionStatus, GuidanceMessageRole, Prisma } from '@prisma/client';
import { RecommendationValidatorService } from './recommendation-validator.service';

@Injectable()
export class GuidanceService {
  private readonly logger = new Logger(GuidanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClient,
    private readonly validator: RecommendationValidatorService,
  ) {}

  async createSession(dto: CreateGuidanceSessionDto) {
    // Check if customer exists in care profiles to use as context
    let profile = await this.prisma.customerCareProfile.findUnique({
      where: { customerId: dto.customerId },
      include: { concerns: { include: { concern: true } } },
    });

    if (!profile) {
      // Create empty profile if none exists so we can at least associate it
      await this.prisma.customerCareProfile.create({
        data: { customerId: dto.customerId! },
      });
      profile = await this.prisma.customerCareProfile.findUnique({
        where: { customerId: dto.customerId },
        include: { concerns: { include: { concern: true } } },
      });
    }

    const session = await this.prisma.guidanceSession.create({
      data: {
        customerId: dto.customerId!,
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

    return this.processAiResponse(session);
  }

  async retryLastMessage(sessionId: string) {
    const session = await this.getSession(sessionId);
    
    const lastMessage = session.messages[session.messages.length - 1];
    if (!lastMessage || lastMessage.role !== GuidanceMessageRole.user) {
      throw new BadRequestException('Can only retry if the last message was from the user.');
    }

    return this.processAiResponse(session);
  }

  private async processAiResponse(session: any) {
    const sessionId = session.id;

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
      if (err instanceof AiClientError) {
        if (err.kind === AiErrorKind.UNAVAILABLE || err.kind === AiErrorKind.TIMEOUT) {
          throw new ServiceUnavailableException({
            message: 'AI recommendation service is temporarily unavailable. Please try again.',
            reason: err.kind,
            retryable: true,
          });
        }
        if (err.kind === AiErrorKind.INVALID_RESPONSE || err.kind === AiErrorKind.INCOMPATIBLE_SCHEMA) {
          this.logger.error(`AI response malformed: ${err.message}`);
          throw new BadGatewayException({
            message: 'AI recommendation service returned an invalid response.',
            reason: err.kind,
            retryable: false,
          });
        }
      }
      this.logger.error(`Unknown AI error: ${err}`);
      throw new InternalServerErrorException('Failed to process AI recommendation.');
    }

    // Validate proposal against trusted backend state before persisting
    if (result.proposal) {
      const validationResult = await this.validator.validateProposal(result.proposal);

      if (!validationResult.isValid) {
        this.logger.warn(
          `AI recommendation validation failed for session ${sessionId}: ${validationResult.errors.join('; ')}`
        );

        // Return a message explaining validation failure instead of persisting invalid recommendation
        const validationFailureMsg = await this.prisma.guidanceMessage.create({
          data: {
            sessionId: session.id,
            role: GuidanceMessageRole.system,
            content:
              'I apologize, but the routine I suggested references products that are not currently available. ' +
              'Let me help you find alternatives.',
          },
        });
        return validationFailureMsg;
      }

      this.logger.log(`AI recommendation validated successfully for session ${sessionId}`);
    }

    // Save assistant response (only if validation passed or no proposal)
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
