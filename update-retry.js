const fs = require('fs');
let code = fs.readFileSync('apps/api/src/modules/guidance/services/guidance.service.ts', 'utf8');

const target = `  async sendMessage(sessionId: string, dto: SendGuidanceMessageDto) {
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
    };`;

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
    };`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('apps/api/src/modules/guidance/services/guidance.service.ts', code);
  console.log('Successfully refactored guidance.service.ts for retry logic');
} else {
  console.log('Target not found in guidance.service.ts!');
}
