import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductsController {
    constructor(private readonly productsService: ProductsService) { }

    @Post()
    create(@Body() createProductDto: CreateProductDto) {
        return this.productsService.create(createProductDto);
    }

    @Get()
    findAll() {
        return this.productsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.productsService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
        return this.productsService.update(id, updateProductDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.productsService.remove(id);
    }

    // 🆕 Bonus Policy CRUD
    @Get(':id/bonus-policies')
    findBonusPolicies(@Param('id') id: string) {
        return this.productsService.findBonusPolicies(id);
    }

    @Post(':id/bonus-policies')
    createBonusPolicy(@Param('id') id: string, @Body() body: any) {
        return this.productsService.createBonusPolicy(id, body);
    }

    @Patch(':id/bonus-policies/:policyId')
    updateBonusPolicy(
        @Param('id') id: string,
        @Param('policyId') policyId: string,
        @Body() body: any
    ) {
        return this.productsService.updateBonusPolicy(id, policyId, body);
    }

    @Delete(':id/bonus-policies/:policyId')
    deleteBonusPolicy(
        @Param('id') id: string,
        @Param('policyId') policyId: string
    ) {
        return this.productsService.deleteBonusPolicy(policyId);
    }
}
