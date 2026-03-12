import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

@Controller('departments')
export class DepartmentsController {
    constructor(private readonly departmentsService: DepartmentsService) { }

    @Get()
    findAll() {
        return this.departmentsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.departmentsService.findOne(id);
    }

    @Post()
    create(@Body() data: { name: string, note?: string }) {
        return this.departmentsService.create(data);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() data: { name?: string, note?: string }) {
        return this.departmentsService.update(id, data);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.departmentsService.remove(id);
    }
}
