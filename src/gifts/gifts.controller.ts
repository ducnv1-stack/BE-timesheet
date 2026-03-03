import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { GiftsService } from './gifts.service';
import { CreateGiftDto } from './dto/create-gift.dto';
import { UpdateGiftDto } from './dto/update-gift.dto';

@Controller('gifts')
export class GiftsController {
    constructor(private readonly giftsService: GiftsService) { }

    @Post()
    create(@Body() createGiftDto: CreateGiftDto) {
        return this.giftsService.create(createGiftDto);
    }

    @Get()
    findAll() {
        return this.giftsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.giftsService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateGiftDto: UpdateGiftDto) {
        return this.giftsService.update(id, updateGiftDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.giftsService.remove(id);
    }
}
