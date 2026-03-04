import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('addresses')
export class AddressesController {
    constructor(private prisma: PrismaService) { }

    @Get('provinces')
    async getProvinces() {
        return this.prisma.province.findMany({
            orderBy: { name: 'asc' },
        });
    }

    @Get('provinces/:provinceId/wards')
    async getWardsByProvince(@Param('provinceId') provinceId: string) {
        return this.prisma.ward.findMany({
            where: { provinceId },
            orderBy: { name: 'asc' },
        });
    }
}
