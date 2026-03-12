import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { PositionsService } from './positions.service';

@Controller('positions')
export class PositionsController {
    constructor(private readonly positionsService: PositionsService) { }

    @Get()
    findAll() {
        return this.positionsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.positionsService.findOne(id);
    }

    @Post()
    create(@Body() data: { 
        name: string, 
        attendancePolicyId?: string, 
        note?: string,
        baseSalary?: number,
        diligentSalary?: number,
        allowance?: number,
        standardWorkingDays?: number
    }) {
        return this.positionsService.create(data);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() data: { 
        name?: string, 
        attendancePolicyId?: string, 
        note?: string,
        baseSalary?: number,
        diligentSalary?: number,
        allowance?: number,
        standardWorkingDays?: number
    }) {
        return this.positionsService.update(id, data);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.positionsService.remove(id);
    }
}
