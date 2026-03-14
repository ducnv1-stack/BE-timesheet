import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceCalculatorService } from './attendance-calculator.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    providers: [AttendanceService, AttendanceCalculatorService],
    controllers: [AttendanceController],
    exports: [AttendanceService, AttendanceCalculatorService],
})
export class AttendanceModule { }
