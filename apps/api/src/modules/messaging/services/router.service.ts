import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppAdapter } from './whatsapp.adapter';

export type Channel = 'whatsapp' | 'messenger' | 'instagram' | 'none';
export type OrderSource = 'website' | 'whatsapp' | 'messenger' | 'instagram' | 'other';

export interface MessageIntent {
  recipientId: string; // Customer ID or Phone depending on context
  channelPreference?: Channel;
  orderSource?: OrderSource;
  templateId: string;
  payload: any;
}

@Injectable()
export class MessagingRouterService {
  private readonly logger = new Logger(MessagingRouterService.name);

  constructor(private readonly whatsappAdapter: WhatsAppAdapter) {}

  /**
   * Evaluates eligibility and routes the message intent to the appropriate provider adapter.
   * Lifecycle Intent → Eligibility/Suppression → Channel Router → Provider Adapter
   */
  async routeMessage(intent: MessageIntent): Promise<{ success: boolean; channel: Channel; messageId?: string }> {
    const selectedChannel = this.evaluateChannel(intent);

    if (selectedChannel === 'none') {
      this.logger.warn(`Message routing unresolved for recipient: ${intent.recipientId}`);
      return { success: false, channel: 'none' };
    }

    try {
      if (selectedChannel === 'whatsapp') {
        const result = await this.whatsappAdapter.sendMessage(intent.recipientId, intent.templateId, intent.payload);
        return { success: true, channel: 'whatsapp', messageId: result.messageId };
      }
      
      // Fallback for unimplemented channels in MVP
      this.logger.warn(`Adapter not implemented for channel: ${selectedChannel}`);
      return { success: false, channel: selectedChannel };
    } catch (error) {
      this.logger.error(`Failed to route message via ${selectedChannel}`, error);
      // "provider failure does not change lifecycle as if contact succeeded"
      throw error;
    }
  }

  private evaluateChannel(intent: MessageIntent): Channel {
    // Basic Routing v1 Rules:
    // website → WhatsApp after explicit opt-in (assuming phone is valid)
    // WhatsApp-origin → WhatsApp
    // Messenger/Instagram → retain origin, optionally fallback
    
    if (intent.orderSource === 'whatsapp') return 'whatsapp';
    if (intent.orderSource === 'messenger') return 'messenger';
    if (intent.orderSource === 'instagram') return 'instagram';
    
    if (intent.orderSource === 'website' || !intent.orderSource) {
      // Default to WhatsApp for website if not specified otherwise
      return intent.channelPreference || 'whatsapp';
    }

    return 'none';
  }
}
