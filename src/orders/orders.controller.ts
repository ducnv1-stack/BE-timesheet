import { Controller, Get, Post, Body, Query, Param, Patch, Delete, BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Controller('orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) { }

    @Post()
    create(@Body() createOrderDto: CreateOrderDto) {
        // Use createdBy from body if provided (temp fix until JWT)
        const userId = (createOrderDto as any).createdBy || '00000000-0000-0000-0000-000000000000';
        return this.ordersService.create(createOrderDto, userId);
    }

    @Get('logs')
    getLogs(@Query('userId') userId: string) {
        if (!userId) throw new BadRequestException('userId is required');
        return this.ordersService.getLogs(userId);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body() updateOrderDto: UpdateOrderDto,
        @Query('userId') userId: string
    ) {
        if (!userId) throw new BadRequestException('userId is required');
        return this.ordersService.update(id, updateOrderDto, userId);
    }

    @Patch(':id/confirm-delivery')
    confirmDelivery(
        @Param('id') id: string,
        @Query('userId') userId: string
    ) {
        if (!userId) throw new BadRequestException('userId is required');
        return this.ordersService.confirmDelivery(id, userId);
    }

    @Patch(':id/confirm-payment')
    confirmPayment(
        @Param('id') id: string,
        @Query('userId') userId: string
    ) {
        if (!userId) throw new BadRequestException('userId is required');
        return this.ordersService.confirmPayment(id, userId);
    }

    @Patch(':id/confirm-invoice')
    confirmInvoice(
        @Param('id') id: string,
        @Query('userId') userId: string
    ) {
        if (!userId) throw new BadRequestException('userId is required');
        return this.ordersService.confirmInvoice(id, userId);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.ordersService.findOne(id);
    }

    @Get()
    findAll(
        @Query('userId') userId?: string,
        @Query('roleCode') roleCode?: string,
        @Query('branchId') branchId?: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('search') search?: string,
        @Query('status') status?: string,
        @Query('paymentStatus') paymentStatus?: string,
        @Query('paymentMethod') paymentMethod?: string,
        @Query('invoiceStatus') invoiceStatus?: string,
        @Query('timeFilter') timeFilter?: string,
        @Query('tab') tab?: string,
        @Query('employeeId') employeeId?: string,
        @Query('lowPrice') lowPrice?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string
    ) {
        return this.ordersService.findAll(
            userId,
            roleCode,
            branchId,
            page,
            limit,
            search,
            status,
            paymentStatus,
            paymentMethod,
            invoiceStatus,
            timeFilter,
            tab,
            employeeId,
            lowPrice,
            startDate,
            endDate
        );
    }

    @Delete(':id')
    async remove(
        @Param('id') id: string,
        @Query('userId') userId: string
    ) {
        if (!userId) throw new BadRequestException('userId is required');
        return this.ordersService.remove(id, userId);
    }
}
