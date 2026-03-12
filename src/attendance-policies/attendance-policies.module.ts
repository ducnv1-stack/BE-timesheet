import { Module } from '@nestjs/common';
import { AttendancePoliciesService } from './attendance-policies.service';
import { AttendancePoliciesController } from './attendance-policies.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AttendancePoliciesController],
    providers: [AttendancePoliciesService],
    exports: [AttendancePoliciesService]
})
export class AttendancePoliciesModule { }
