import { Module } from '@nestjs/common';
import { CommerceService } from './services/commerce.service';

@Module({
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}
