import { Controller, Get, Post, Body, Patch, Param, Query, UseInterceptors, UploadedFiles, BadRequestException } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { renameSync } from 'fs';
import { AttendanceExceptionRequestsService } from './attendance-exception-requests.service';
import { CreateExceptionRequestDto } from './dto/create-exception-request.dto';
import { UpdateExceptionRequestStatusDto } from './dto/update-exception-request-status.dto';

@Controller('attendance-exception-requests')
export class AttendanceExceptionRequestsController {
  constructor(private readonly service: AttendanceExceptionRequestsService) {}

  @Post()
  create(@Body() createDto: CreateExceptionRequestDto) {
    return this.service.create(createDto);
  }

  @Post('upload-images')
  @UseInterceptors(FilesInterceptor('images', 5, {
    storage: diskStorage({
      destination: './public/uploads/exceptions',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + extname(file.originalname));
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
        return cb(new BadRequestException('Chỉ hỗ trợ file ảnh (jpg, png, gif, webp)'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  }))
  uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Không có file nào được tải lên');
    }
    const imageUrls = files.map(file => `/uploads/exceptions/${file.filename}`);
    return { imageUrls };
  }

  @Get()
  findAll(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.findAll({ employeeId, status, branchId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() updateDto: UpdateExceptionRequestStatusDto) {
    return this.service.updateStatus(id, updateDto);
  }
}
