const fs = require('fs');
let code = fs.readFileSync('apps/api/src/modules/guidance/services/guidance.service.ts', 'utf8');

// We use startIdx and endIdx
const startIdx = code.indexOf('  async sendMessage');
const endIdx = code.indexOf('let result;', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `  async sendMessage(sessionId: string, dto: SendGuidanceMessageDto) {
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

    `;

  code = code.substring(0, startIdx) + replacement + code.substring(endIdx);
  fs.writeFileSync('apps/api/src/modules/guidance/services/guidance.service.ts', code);
  console.log('Successfully refactored guidance.service.ts for retry logic');
} else {
  console.log('Bounds not found');
}
