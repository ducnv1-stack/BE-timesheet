import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional, Min, Max, IsUUID, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDeliveryDto {
    @IsOptional()
    @IsUUID()
    driverId?: string;

    @IsString()
    @IsNotEmpty()
    @IsEnum(['COMPANY_DRIVER', 'EXTERNAL_DRIVER', 'STAFF_DELIVERER', 'SELLING_SALE', 'OTHER_SALE'])
    category: string;

    @IsOptional()
    @IsNumber()
    deliveryFee?: number;
}

export class CreateOrderGiftDto {
    @IsUUID()
    giftId: string;

    @IsNumber()
    @Min(1)
    quantity: number;
}

export class CreateOrderItemDto {
    @IsUUID()
    productId: string;

    @IsNumber()
    @Min(1)
    quantity: number;

    @IsNumber()
    @Min(0)
    unitPrice: number;
}

export class CreateOrderSplitDto {
    @IsUUID()
    employeeId: string;

    @IsUUID()
    branchId: string;

    @IsNumber()
    @Min(0)
    @Max(100)
    splitPercent: number;

    @IsNumber()
    @Min(0)
    splitAmount: number;
}

export class CreatePaymentDto {
    @IsString()
    @IsNotEmpty()
    paymentMethod: string;

    @IsNumber()
    @Min(0)
    amount: number;

    @IsString()
    @IsNotEmpty()
    paidAt: string; // ISO Date
}

export class CreateOrderDto {
    @IsUUID()
    branchId: string;

    @IsString()
    @IsNotEmpty()
    customerName: string;

    @IsString()
    @IsNotEmpty()
    customerPhone: string;

    @IsString()
    @IsOptional()
    customerAddress?: string;

    @IsString()
    @IsOptional()
    customerCardNumber?: string;

    @IsString()
    @IsOptional()
    customerCardIssueDate?: string;

    @IsOptional()
    @IsUUID()
    staffCode?: string;

    @IsUUID()
    createdBy?: string;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => CreateDeliveryDto)
    deliveries?: CreateDeliveryDto[];

    @IsString()
    @IsNotEmpty()
    orderDate: string; // ISO Date

    @IsString()
    @IsNotEmpty()
    orderSource: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateOrderItemDto)
    items: CreateOrderItemDto[];

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateOrderSplitDto)
    splits: CreateOrderSplitDto[];

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePaymentDto)
    payments: CreatePaymentDto[];

    @IsString()
    @IsOptional()
    note?: string;

    @IsNumber()
    @IsOptional()
    totalAmount?: number;

    @IsNumber()
    @IsOptional()
    giftAmount?: number;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => CreateOrderGiftDto)
    gifts?: CreateOrderGiftDto[];
}
