import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { AttendancePoliciesService } from './attendance-policies.service';

@Controller('attendance-policies')
export class AttendancePoliciesController {
    constructor(private readonly attendancePoliciesService: AttendancePoliciesService) { }

    @Get()
    findAll() {
        return this.attendancePoliciesService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.attendancePoliciesService.findOne(id);
    }

    @Post()
    create(@Body() data: { name: string, note?: string, latitude?: number, longitude?: number, radius?: number, days: any[] }) {
        return this.attendancePoliciesService.create(data);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() data: { name?: string, note?: string, latitude?: number, longitude?: number, radius?: number, days?: any[] }) {
        return this.attendancePoliciesService.update(id, data);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.attendancePoliciesService.remove(id);
    }
}
