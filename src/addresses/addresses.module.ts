import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AddressesController],
})
export class AddressesModule { }
