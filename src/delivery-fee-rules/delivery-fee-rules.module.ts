import { Module } from '@nestjs/common';
import { DeliveryFeeRulesService } from './delivery-fee-rules.service';
import { DeliveryFeeRulesController } from './delivery-fee-rules.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [DeliveryFeeRulesController],
    providers: [DeliveryFeeRulesService],
    exports: [DeliveryFeeRulesService],
})
export class DeliveryFeeRulesModule { }
