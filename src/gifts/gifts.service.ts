import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGiftDto } from './dto/create-gift.dto';
import { UpdateGiftDto } from './dto/update-gift.dto';

@Injectable()
export class GiftsService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.gift.findMany({
            orderBy: { createdAt: 'desc' },
        });
    }

    async findOne(id: string) {
        const gift = await this.prisma.gift.findUnique({
            where: { id },
        });
        if (!gift) throw new NotFoundException('Quà tặng không tồn tại');
        return gift;
    }

    async create(createGiftDto: CreateGiftDto) {
        return this.prisma.gift.create({
            data: createGiftDto
        });
    }

    async update(id: string, updateGiftDto: UpdateGiftDto) {
        return this.prisma.gift.update({
            where: { id },
            data: updateGiftDto,
        });
    }

    async remove(id: string) {
        return this.prisma.gift.delete({
            where: { id }
        });
    }
}
