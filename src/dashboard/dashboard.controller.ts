import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) { }

    @Get()
    async getDashboard(
        @Query('userId') userId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('branchId') branchId?: string
    ) {
        if (!userId) {
            throw new UnauthorizedException('User ID is required');
        }
        return this.dashboardService.getDashboardData(userId, startDate, endDate, branchId);
    }

    @Get('leaderboard')
    async getLeaderboard(
        @Query('userId') userId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('branchId') branchId?: string
    ) {
        if (!userId) {
            throw new UnauthorizedException('User ID is required');
        }
        return this.dashboardService.getLeaderboardData(userId, startDate, endDate, branchId);
    }

    @Get('violated-orders')
    async getViolatedOrders(
        @Query('userId') userId: string,
        @Query('branchId') branchId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string
    ) {
        if (!userId || !branchId) {
            throw new UnauthorizedException('User ID and Branch ID are required');
        }
        return this.dashboardService.getViolatedOrders(
            userId,
            branchId,
            startDate,
            endDate
        );
    }
}
