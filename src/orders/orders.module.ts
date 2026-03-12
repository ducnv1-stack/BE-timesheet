import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DeliveryFeeRulesModule } from '../delivery-fee-rules/delivery-fee-rules.module';
import { StocksModule } from '../stocks/stocks.module';

@Module({
  imports: [PrismaModule, DeliveryFeeRulesModule, StocksModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule { }
