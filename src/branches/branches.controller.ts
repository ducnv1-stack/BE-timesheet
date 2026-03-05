import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
    constructor(private readonly branchesService: BranchesService) { }

    @Get()
    findAll() {
        return this.branchesService.findAll();
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() data: { latitude?: number, longitude?: number, checkinRadius?: number }) {
        return this.branchesService.update(id, data);
    }
}
