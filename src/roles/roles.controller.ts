import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateRoleDto } from './dto/update-role.dto';

@Controller('roles')
export class RolesController {
    constructor(private prisma: PrismaService) { }

    @Get()
    findAll() {
        return this.prisma.role.findMany({
            orderBy: { name: 'asc' },
        });
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
        return this.prisma.role.update({
            where: { id },
            data: updateRoleDto,
        });
    }
}
