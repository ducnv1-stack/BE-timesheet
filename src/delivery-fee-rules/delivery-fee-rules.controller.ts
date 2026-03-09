import { Controller, Get, Post, Patch, Delete, Body, Param, BadRequestException } from '@nestjs/common';
import { DeliveryFeeRulesService } from './delivery-fee-rules.service';

@Controller('delivery-fee-rules')
export class DeliveryFeeRulesController {
    constructor(private readonly service: DeliveryFeeRulesService) { }

    @Get()
    findAll() {
        return this.service.findAll();
    }

    @Post()
    create(@Body() body: { branchId?: string; deliveryCategory: string; feeAmount: number }) {
        if (!body.deliveryCategory) throw new BadRequestException('deliveryCategory is required');
        if (body.feeAmount === undefined) throw new BadRequestException('feeAmount is required');
        return this.service.create(body);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() body: { feeAmount?: number; isActive?: boolean }) {
        return this.service.update(id, body);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.service.remove(id);
    }
}
