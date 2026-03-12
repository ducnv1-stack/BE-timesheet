import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { OrdersModule } from './orders/orders.module';
import { BranchesModule } from './branches/branches.module';
import { EmployeesModule } from './employees/employees.module';
import { ProductsModule } from './products/products.module';
import { GiftsModule } from './gifts/gifts.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { RolesModule } from './roles/roles.module';
import { AddressesModule } from './addresses/addresses.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DeliveryFeeRulesModule } from './delivery-fee-rules/delivery-fee-rules.module';
import { StocksModule } from './stocks/stocks.module';
import { DepartmentsModule } from './departments/departments.module';
import { PositionsModule } from './positions/positions.module';
import { AttendancePoliciesModule } from './attendance-policies/attendance-policies.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/',
    }),
    PrismaModule,
    OrdersModule,
    BranchesModule,
    EmployeesModule,
    ProductsModule,
    GiftsModule,
    AuthModule,
    DashboardModule,
    RolesModule,
    AddressesModule,
    AttendanceModule,
    DeliveryFeeRulesModule,
    StocksModule,
    DepartmentsModule,
    PositionsModule,
    AttendancePoliciesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
