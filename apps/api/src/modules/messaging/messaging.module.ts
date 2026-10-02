import { Module } from '@nestjs/common';
import { MessagingRouterService } from './services/router.service';
import { WhatsAppAdapter } from './services/whatsapp.adapter';

@Module({
  providers: [MessagingRouterService, WhatsAppAdapter],
  exports: [MessagingRouterService],
})
export class MessagingModule {}
