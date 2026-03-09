import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DeliveryFeeRulesModule } from '../delivery-fee-rules/delivery-fee-rules.module';

@Module({
  imports: [PrismaModule, DeliveryFeeRulesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule { }
