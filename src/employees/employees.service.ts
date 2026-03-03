import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ToggleAccountDto } from './dto/toggle-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmployeesService {
    constructor(private prisma: PrismaService) { }

    async findAll(query: {
        branchId?: string;
        position?: string;
        status?: string;
        hasAccount?: 'true' | 'false';
        userId?: string;
        roleCode?: string;
    }) {
        const { userId, roleCode } = query;
        let where: any = {};

        // Role-based visibility logic
        if (roleCode && userId) {
            if (['DIRECTOR', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT'].includes(roleCode)) {
                // Global: No forced filters, use query filters if provided
                if (query.branchId) where.branchId = query.branchId;
            } else if (['MANAGER'].includes(roleCode)) {
                // Branch: Find the user's branch first
                const userEmployee = await this.prisma.employee.findFirst({
                    where: { userId },
                    select: { branchId: true }
                });

                if (userEmployee?.branchId) {
                    where.branchId = userEmployee.branchId;
                } else {
                    // If no branch assigned, they see nothing or maybe themselves?
                    // Usually branch roles HAVE a branch.
                    where.userId = userId;
                }
            } else {
                // Personal: Only see themselves
                where.userId = userId;
            }
        }

        // Additional filters from query
        if (query.position) {
            where.position = query.position;
        }

        if (query.status) {
            where.status = query.status;
        }

        // Filter by account existence
        if (query.hasAccount === 'true') {
            where.userId = roleCode && !['DIRECTOR', 'CHIEF_ACCOUNTANT', 'MANAGER', 'ACCOUNTANT'].includes(roleCode)
                ? where.userId // Keep personal filter
                : { not: null };
        } else if (query.hasAccount === 'false') {
            // If they can only see themselves (who HAS an account), filtering for 'no account' returns empty
            where.userId = null;
        }

        return this.prisma.employee.findMany({
            where,
            include: {
                branch: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        isActive: true,
                        role: true,
                    }
                }
            },
            orderBy: { fullName: 'asc' },
        });
    }

    async findOne(id: string) {
        const employee = await this.prisma.employee.findUnique({
            where: { id },
            include: {
                branch: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        isActive: true,
                        createdAt: true,
                        role: true,
                    }
                }
            },
        });

        if (!employee) {
            throw new NotFoundException(`Employee with ID ${id} not found`);
        }

        return employee;
    }

    async create(createEmployeeDto: CreateEmployeeDto) {
        const { branchId, ...employeeData } = createEmployeeDto;

        // Verify branch exists
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
        });

        if (!branch) {
            throw new BadRequestException(`Branch with ID ${branchId} not found`);
        }

        // Create employee
        const employee = await this.prisma.employee.create({
            data: {
                ...employeeData,
                branchId,
                birthday: employeeData.birthday ? new Date(employeeData.birthday) : null,
                joinDate: employeeData.joinDate ? new Date(employeeData.joinDate) : null,
                contractSigningDate: employeeData.contractSigningDate ? new Date(employeeData.contractSigningDate) : null,
                birthMonth: employeeData.birthday ? new Date(employeeData.birthday).getMonth() + 1 : null,
            },
            include: {
                branch: true,
            },
        });

        return employee;
    }

    async update(id: string, updateEmployeeDto: UpdateEmployeeDto, currentUserId: string) {
        const employee = await this.findOne(id);

        const { branchId, ...updateData } = updateEmployeeDto;

        // Convert date strings to Date objects for Prisma
        if (updateData.birthday) {
            const bday = new Date(updateData.birthday);
            (updateData as any).birthday = bday;
            (updateData as any).birthMonth = bday.getMonth() + 1;
        }

        if (updateData.joinDate) {
            (updateData as any).joinDate = new Date(updateData.joinDate);
        }

        if (updateData.contractSigningDate) {
            (updateData as any).contractSigningDate = new Date(updateData.contractSigningDate);
        }

        const updated = await this.prisma.employee.update({
            where: { id },
            data: {
                ...updateData,
                ...(branchId && { branchId }),
            },
            include: {
                branch: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        isActive: true,
                        role: true,
                    }
                }
            },
        });

        return updated;
    }

    async remove(id: string) {
        const employee = await this.findOne(id);

        // Check if employee has a user account
        if (employee.userId) {
            throw new BadRequestException('Cannot delete employee with an active user account. Please remove the account first.');
        }

        await this.prisma.employee.delete({
            where: { id },
        });

        return { message: 'Employee deleted successfully' };
    }

    // ========== ACCOUNT MANAGEMENT ==========

    async createAccount(employeeId: string, createAccountDto: CreateAccountDto) {
        const employee = await this.findOne(employeeId);

        if (employee.userId) {
            throw new BadRequestException('Employee already has an account');
        }

        // Check if username already exists
        const existingUser = await this.prisma.user.findUnique({
            where: { username: createAccountDto.username },
        });

        if (existingUser) {
            throw new BadRequestException('Username already exists');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(createAccountDto.password, 10);

        // Create user account
        const user = await this.prisma.user.create({
            data: {
                username: createAccountDto.username,
                passwordHash,
                roleId: createAccountDto.roleId,
            },
        });

        // Link user to employee
        await this.prisma.employee.update({
            where: { id: employeeId },
            data: { userId: user.id },
        });

        return {
            message: 'Account created successfully',
            username: user.username,
        };
    }

    async resetPassword(employeeId: string, resetPasswordDto: ResetPasswordDto) {
        const employee = await this.findOne(employeeId);

        if (!employee.userId) {
            throw new BadRequestException('Employee does not have an account');
        }

        const passwordHash = await bcrypt.hash(resetPasswordDto.newPassword, 10);

        await this.prisma.user.update({
            where: { id: employee.userId },
            data: { passwordHash },
        });

        return { message: 'Password reset successfully' };
    }

    async toggleAccount(employeeId: string, toggleAccountDto: ToggleAccountDto) {
        const employee = await this.findOne(employeeId);

        if (!employee.userId) {
            throw new BadRequestException('Employee does not have an account');
        }

        await this.prisma.user.update({
            where: { id: employee.userId },
            data: { isActive: toggleAccountDto.isActive },
        });

        return {
            message: toggleAccountDto.isActive ? 'Account activated successfully' : 'Account deactivated successfully'
        };
    }

    async updateAccount(employeeId: string, updateAccountDto: UpdateAccountDto) {
        const employee = await this.findOne(employeeId);

        if (!employee.userId) {
            throw new BadRequestException('Employee does not have an account');
        }

        // If username is being changed, check for uniqueness
        if (updateAccountDto.username) {
            const existingUser = await this.prisma.user.findFirst({
                where: {
                    username: updateAccountDto.username,
                    id: { not: employee.userId }
                },
            });

            if (existingUser) {
                throw new BadRequestException('Username already exists');
            }
        }

        await this.prisma.user.update({
            where: { id: employee.userId },
            data: {
                ...(updateAccountDto.username && { username: updateAccountDto.username }),
                ...(updateAccountDto.roleId && { roleId: updateAccountDto.roleId }),
            },
        });

        return { message: 'Account updated successfully' };
    }

    async getPerformanceStats(id: string, month: number, year: number) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        // Fetch employee to check role
        const employee = await this.prisma.employee.findUnique({ where: { id } });
        if (!employee) throw new NotFoundException('Employee not found');

        // Fetch salary rules (milestones)
        const salaryRules = await this.prisma.salesSalaryRule.findMany({
            orderBy: { targetRevenue: 'desc' }
        });

        // Fetch order splits for the employee in the given month
        const splits = await this.prisma.orderSplit.findMany({
            where: {
                employeeId: id,
                order: {
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            },
            include: {
                order: {
                    include: {
                        items: { include: { product: true } }
                    }
                }
            }
        });

        // Fetch deliveries for shipping fees
        const deliveries = await this.prisma.delivery.findMany({
            where: {
                driverId: id,
                order: {
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            }
        });

        const shippingFee = deliveries.reduce((sum, d) => sum + Number(d.deliveryFee), 0);

        let totalRevenue = 0;
        let lowPriceValue = 0;
        let hotBonus = 0;
        let commission = 0;
        const processedOrders = new Set<string>();

        // Manager Commission Rule (Example: 1% if manager? But for now user asked simply.
        // Assuming Commission is 0 for Sale, and Hot Bonus is from High End)
        // If employee is Manager, logic might differ, but let's stick to the requested structure first.

        for (const split of splits) {
            const splitAmount = Number(split.splitAmount);
            totalRevenue += splitAmount;
            processedOrders.add(split.orderId);

            const order = split.order;
            const orderTotal = Number(order.totalAmount);

            if (orderTotal > 0) {
                let orderLowPriceValue = 0;
                let orderHotBonus = 0;

                for (const item of order.items) {
                    // Check Low Price
                    if (Number(item.unitPrice) < Number(item.product.minPrice)) {
                        orderLowPriceValue += Number(item.unitPrice) * item.quantity;
                    }

                    // Hot Bonus (High-end product bonus)
                    if (item.product.isHighEnd) {
                        orderHotBonus += Number(item.saleBonusAmount) * item.quantity;
                    }
                }

                // Apply split ratio to metrics
                const shareRatio = splitAmount / orderTotal;
                lowPriceValue += orderLowPriceValue * shareRatio;
                hotBonus += orderHotBonus * shareRatio;
            }
        }

        // Determine calculation mode based on role/position
        const isManager = employee.position.toLowerCase() === 'manager';
        let baseSalary = 0;
        let baseReward = 0;
        commission = 0; // Reset to recalculate based on role

        if (isManager) {
            // Manager logic: Use branch-specific rules
            const managerRules = await this.prisma.branchManagerSalaryRule.findMany({
                where: { branchId: employee.branchId },
                orderBy: { targetRevenue: 'desc' }
            });

            const achievedRule = managerRules.find(rule => totalRevenue >= Number(rule.targetRevenue));

            if (achievedRule) {
                baseSalary = Number(achievedRule.baseSalary);
                baseReward = Number(achievedRule.bonusAmount);
                // commissionPercent in rules is like 1.5 meaning 1.5%, so divide by 100
                commission = totalRevenue * (Number(achievedRule.commissionPercent) / 100);
            } else {
                // Fallback if no rules found or revenue is below lowest threshold
                baseSalary = 6000000;
            }
        } else {
            // Sale/NVBH logic: Existing logic
            const achievedRule = salaryRules.find(rule => totalRevenue >= Number(rule.targetRevenue));
            baseReward = achievedRule ? Number(achievedRule.bonusAmount) : 0;

            if (employee.position === 'NVBH') {
                baseSalary = 8000000;
            } else if (achievedRule) {
                baseSalary = Number(achievedRule.baseSalary);
            }

            // Commission calculation for Sale (Existing complex logic)
            for (const split of splits) {
                const splitAmount = Number(split.splitAmount);
                const order = split.order;
                const orderTotal = Number(order.totalAmount);

                if (orderTotal > 0) {
                    const shareRatio = splitAmount / orderTotal;
                    for (const item of order.items) {
                        const itemTotal = Number(item.totalPrice);
                        const rate = item.isBelowMin ? 0.01 : 0.018;
                        commission += itemTotal * rate * shareRatio;
                    }
                }
            }
        }

        // Performance Penalty/Clemency Logic (Mainly for Sales, but let's see if it applies to Manager)
        let actualReward = baseReward;
        const ratio = totalRevenue > 0 ? (lowPriceValue / totalRevenue) : 0;
        const isPenalty = ratio >= 0.2;
        let isClemency = false;

        if (isPenalty) {
            actualReward = baseReward * 0.7;
            const saleRule = isManager ? null : salaryRules.find(rule => totalRevenue >= Number(rule.targetRevenue));
            if (!isManager && saleRule && totalRevenue >= Number(saleRule.targetRevenue) * 1.1) {
                actualReward = baseReward;
                isClemency = true;
            }
        }

        const netIncome = baseSalary + commission + hotBonus + shippingFee + actualReward;

        return {
            totalOrders: processedOrders.size,
            totalRevenue,
            lowPriceValue,
            lowPriceRatio: ratio * 100,
            milestone: isManager ? (await this.prisma.branchManagerSalaryRule.findFirst({
                where: { branchId: employee.branchId, targetRevenue: { lte: totalRevenue } },
                orderBy: { targetRevenue: 'desc' }
            }))?.targetRevenue ?? 0 : (salaryRules.find(rule => totalRevenue >= Number(rule.targetRevenue))?.targetRevenue ?? 0),
            baseReward,
            actualReward,
            hotBonus,
            commission,
            shippingFee,
            baseSalary,
            netIncome,
            isPenalty,
            isClemency
        };
    }

    async getPerformanceReport(month: number, year: number) {
        const employees = await this.prisma.employee.findMany({
            include: { branch: true }
        });

        const report = [];
        for (const emp of employees) {
            const stats = await this.getPerformanceStats(emp.id, month, year);
            report.push({
                ...stats,
                employeeId: emp.id,
                fullName: emp.fullName,
                branchName: emp.branch?.name
            });
        }
        return report;
    }
}
