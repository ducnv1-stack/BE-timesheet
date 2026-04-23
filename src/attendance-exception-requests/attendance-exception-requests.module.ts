import { Module } from '@nestjs/common';
import { AttendanceExceptionRequestsService } from './attendance-exception-requests.service';
import { AttendanceExceptionRequestsController } from './attendance-exception-requests.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [PrismaModule, AttendanceModule],
  controllers: [AttendanceExceptionRequestsController],
  providers: [AttendanceExceptionRequestsService],
  exports: [AttendanceExceptionRequestsService],
})
export class AttendanceExceptionRequestsModule {}
