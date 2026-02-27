import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) { }

    @Get()
    async getDashboard(@Query('userId') userId: string) {
        if (!userId) {
            throw new UnauthorizedException('User ID is required');
        }
        return this.dashboardService.getDashboardData(userId);
    }
}
