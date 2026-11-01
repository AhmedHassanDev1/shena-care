import { Injectable, Logger } from '@nestjs/common';

/**
 * Abstract provider adapter pattern.
 * Domain code must not depend on Meta/Twilio/BSP payloads.
 */
@Injectable()
export class WhatsAppAdapter {
  private readonly logger = new Logger(WhatsAppAdapter.name);

  async sendMessage(to: string, templateId: string, variables: any): Promise<{ messageId: string }> {
    this.logger.log(`[Mock WhatsApp] Sending template ${templateId} to ${to} with vars: ${JSON.stringify(variables)}`);
    
    // Simulate provider API call
    return { messageId: `wa_mock_${Date.now()}` };
  }
}
