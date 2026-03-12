import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { StocksService } from './stocks.service';
import { TransactionType } from '@prisma/client';

@Controller('stocks')
export class StocksController {
    constructor(private readonly stocksService: StocksService) { }

    @Post('transactions')
    createTransaction(@Body() body: any, @Request() req: any) {
        // Use current user as creator if not provided (ideal for security)
        const userId = body.createdBy || req.user?.id || 'admin-fallback-uuid'; // Fallback for simple testing
        return this.stocksService.createTransaction({ ...body, createdBy: userId });
    }

    @Get('transactions')
    getHistory(
        @Query('branchId') branchId?: string,
        @Query('productId') productId?: string,
        @Query('type') type?: TransactionType,
    ) {
        return this.stocksService.getHistory({ branchId, productId, type });
    }

    @Get('inventory')
    getInventory(@Query('branchId') branchId?: string) {
        return this.stocksService.getInventory(branchId);
    }
}
