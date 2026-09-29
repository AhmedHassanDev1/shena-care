import { Module } from '@nestjs/common';
import { OrderingService } from './services/ordering.service';
import { CartService } from './services/cart.service';
import { CommerceModule } from '../commerce/public';
import { SourcingModule } from '../sourcing/public';
import { OrderingController } from './ordering.controller';

@Module({
  imports: [CommerceModule, SourcingModule],
  controllers: [OrderingController],
  providers: [OrderingService, CartService],
  exports: [OrderingService, CartService],
})
export class OrderingModule {}
