import { Controller, Get, Post, Body, Query, Param, Patch, Delete, BadRequestException, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
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

    @Get(':id/audit-logs')
    getAuditLogs(@Param('id') id: string) {
        return this.ordersService.getAuditLogs(id);
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
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('tab') tab?: string,
        @Query('employeeId') employeeId?: string,
        @Query('lowPrice') lowPrice?: string,
        @Query('excludeInstallment') excludeInstallment?: string,
        @Query('deliveryType') deliveryType?: string
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
            startDate,
            endDate,
            tab,
            employeeId,
            lowPrice,
            excludeInstallment,
            deliveryType
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

    @Post(':id/images')
    @UseInterceptors(FilesInterceptor('files', 10, {
        storage: diskStorage({
            destination: './public/uploads/orders',
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                const ext = extname(file.originalname);
                cb(null, `${req.params.id}-${uniqueSuffix}${ext}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
                return cb(new BadRequestException('Only image files are allowed!'), false);
            }
            cb(null, true);
        },
        limits: { fileSize: 5 * 1024 * 1024 }
    }))
    uploadImages(@Param('id') id: string, @UploadedFiles() files: Array<Express.Multer.File>) {
        if (!files || files.length === 0) {
            throw new BadRequestException('No files uploaded or file type is invalid');
        }
        const imageUrls = files.map(f => `/uploads/orders/${f.filename}`);
        return this.ordersService.addImages(id, imageUrls);
    }

    @Delete(':id/images')
    removeImage(@Param('id') id: string, @Query('imageUrl') imageUrl: string) {
        if (!imageUrl) throw new BadRequestException('imageUrl is required');
        return this.ordersService.removeImage(id, imageUrl);
    }
}
