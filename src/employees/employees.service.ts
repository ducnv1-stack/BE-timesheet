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
        department?: string;
        positionId?: string;
        departmentId?: string;
        roleId?: string;
        hasAccount?: 'true' | 'false';
        userId?: string;
        roleCode?: string;
    }) {
        const { userId, roleCode } = query;
        let where: any = {};

        // Role-based visibility logic
        if (roleCode && userId) {
            if (['DIRECTOR', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'BRANCH_ACCOUNTANT', 'HR', 'ADMIN'].includes(roleCode)) {
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

        if (query.department) {
            where.department = query.department;
        }

        if ((query as any).positionId) {
            where.positionId = (query as any).positionId;
        }

        if ((query as any).departmentId) {
            where.departmentId = (query as any).departmentId;
        }

        if (query.roleId) {
            where.user = {
                roleId: query.roleId
            };
        }

        // Filter by account existence
        if (query.hasAccount === 'true') {
            where.userId = roleCode && !['DIRECTOR', 'CHIEF_ACCOUNTANT', 'MANAGER', 'ACCOUNTANT', 'BRANCH_ACCOUNTANT', 'HR', 'ADMIN'].includes(roleCode)
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
                pos: { select: { id: true, name: true } },
                dept: { select: { id: true, name: true } },
                attendancePolicy: { select: { id: true, name: true } },
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

    async findAllFull() {
        return this.prisma.employee.findMany({
            include: {
                branch: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        passwordHash: true,
                        isActive: true,
                        role: true,
                    }
                }
            },
            orderBy: [{ branch: { name: 'asc' } }, { fullName: 'asc' }],
        });
    }

    async getPositions() {
        const positions = await this.prisma.position.findMany({
            select: { name: true },
            orderBy: { name: 'asc' }
        });
        return positions.map(p => p.name);
    }

    async getDepartments() {
        const departments = await this.prisma.department.findMany({
            select: { name: true },
            orderBy: { name: 'asc' }
        });
        return departments.map(d => d.name);
    }

    async findOne(id: string) {
        let employee = await this.prisma.employee.findUnique({
            where: { id },
            include: {
                branch: true,
                pos: { 
                    include: { 
                        attendancePolicy: {
                            include: { days: true }
                        } 
                    } 
                },
                dept: true,
                attendancePolicy: {
                    include: { days: true }
                },
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

        // Fallback: If not found by employee ID, try searching by user ID
        if (!employee) {
            employee = await this.prisma.employee.findFirst({
                where: { userId: id },
                include: {
                    branch: true,
                    pos: { 
                        include: { 
                            attendancePolicy: {
                                include: { days: true }
                            } 
                        } 
                    },
                    dept: true,
                    attendancePolicy: {
                        include: { days: true }
                    },
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
        }

        if (!employee) {
            throw new NotFoundException(`Employee with ID or User ID ${id} not found`);
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
                pos: true,
                dept: true,
                attendancePolicy: true
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
                pos: true,
                dept: true,
                attendancePolicy: true,
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

    async remove(id: string, roleCode?: string) {
        if (roleCode !== 'ADMIN') {
            throw new BadRequestException('Chỉ có quản trị viên mới có quyền xóa nhân viên');
        }

        const employee = await this.findOne(id);

        // Delete employee first - this will trigger CASCADE deletes for Attendance, OrderSplits, etc.
        await this.prisma.employee.delete({
            where: { id },
        });

        // Then delete the user account if it exists
        if (employee.userId) {
            try {
                await this.prisma.user.delete({
                    where: { id: employee.userId }
                });
            } catch (error) {
                // If user deletion fails (e.g. they created orders), we just log it
                // since the employee link is already gone.
                console.error('Could not delete user account:', error);
            }
        }

        return { message: 'Nhân viên và dữ liệu liên quan đã được xóa vĩnh viễn' };
    }

    async getAccountSummary() {
        const roles = await this.prisma.role.findMany({
            include: {
                _count: {
                    select: { users: true }
                }
            },
            orderBy: { name: 'asc' }
        });

        return roles.map(role => ({
            id: role.id,
            code: role.code,
            name: role.name,
            count: role._count.users
        }));
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
        // For TIMESTAMP columns (confirmedAt) — local timezone for month range
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        // For DATE columns (orderDate) — UTC midnight for correct comparison
        const orderStartDate = new Date(Date.UTC(year, month - 1, 1));
        const orderEndDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

        const employee = await this.prisma.employee.findUnique({
            where: { id },
            include: { 
                user: { include: { role: true } },
                pos: true
            }
        });
        if (!employee) throw new NotFoundException('Employee not found');

        const position = employee.position || '';
        const roleCode = employee.user?.role?.code || '';

        // Category mapping
        const isManager = ['manager', 'quản lý', 'gdkd', 'gđkd'].includes(position.toLowerCase()) || roleCode === 'MANAGER';
        const isSale = ['nvbh', 'sale'].includes(position.toLowerCase()) || roleCode === 'SALE';
        const isMarketing = ['marketing'].includes(position.toLowerCase()) || roleCode === 'MARKETING';
        const isTelesale = ['telesale'].includes(position.toLowerCase()) || roleCode === 'TELESALE';
        const isDriver = ['nvgh', 'lái xe'].includes(position.toLowerCase()) || ['DRIVER', 'COMPANY_DRIVER', 'DELIVERY_STAFF'].includes(roleCode);

        // Common metrics
        let totalOrders = 0;
        let totalRevenue = 0;
        let grossRevenue = 0; // Doanh số bán (chỉ xét ngày tạo)
        let lowPriceValue = 0;
        let lowPriceRatio = 0;
        let commission = 0;
        let hotBonus = 0;
        let shippingFee = 0;
        let baseSalary = 0;
        let baseReward = 0;
        let actualReward = 0;
        let milestone = 0;
        let diligentSalary = 0;
        let allowance = 0;
        let actualWorkingDays = 0;
        let isPenalty = false;
        let isClemency = false;

        // Branch metrics (for reference)
        const branchOrders = await this.prisma.order.findMany({
            where: {
                branchId: employee.branchId,
                isPaymentConfirmed: true,
                confirmedAt: { gte: startDate, lte: endDate }
            },
            include: { deliveries: true, items: { include: { product: true } } }
        });
        const branchTotalOrders = branchOrders.length;
        const branchTotalRevenue = branchOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

        const branchOrdersCreated = await this.prisma.order.findMany({
            where: { branchId: employee.branchId, status: { notIn: ['canceled', 'rejected'] }, orderDate: { gte: orderStartDate, lte: orderEndDate } }
        });
        const branchGrossRevenue = branchOrdersCreated.reduce((sum, o) => sum + Number(o.totalAmount), 0);

        if (isManager) {
            // MANAGER LOGIC — Thống nhất dùng OrderSplit giống Dashboard để khớp số liệu
            const rules = await this.prisma.branchManagerSalaryRule.findMany({
                where: { branchId: employee.branchId },
                orderBy: { targetRevenue: 'desc' }
            });

            // 1. Doanh số hoàn thành (Confirmed)
            const branchSplits = await this.prisma.orderSplit.findMany({
                where: {
                    branchId: employee.branchId,
                    order: {
                        isPaymentConfirmed: true,
                        status: { notIn: ['canceled', 'rejected'] },
                        confirmedAt: { gte: startDate, lte: endDate }
                    }
                },
                include: {
                    order: {
                        include: {
                            items: { include: { product: true } },
                            deliveries: true
                        }
                    }
                }
            });

            // 2. Doanh số bán (Created/OrderDate)
            const branchSalesSplits = await this.prisma.orderSplit.findMany({
                where: {
                    branchId: employee.branchId,
                    order: {
                        status: { notIn: ['canceled', 'rejected'] },
                        orderDate: { gte: orderStartDate, lte: orderEndDate }
                    }
                }
            });

            totalRevenue = branchSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);
            grossRevenue = branchSalesSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);
            
            // Đơn bán: Chỉ tính đơn thuộc chi nhánh chủ quản
            totalOrders = await this.prisma.order.count({
                where: {
                    branchId: employee.branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                }
            });

            const achievedRule = rules.find(r => totalRevenue >= Number(r.targetRevenue));
            if (achievedRule) {
                baseSalary = Number(achievedRule.baseSalary);
                baseReward = Number(achievedRule.bonusAmount);
                commission = totalRevenue * (Number(achievedRule.commissionPercent) / 100);
                milestone = Number(achievedRule.targetRevenue);
            }

            // Manager Hot Bonus & Low Price from branch splits (có nhân tỉ lệ chia sẻ)
            for (const split of branchSplits) {
                const order = split.order;
                const shareRatio = Number(split.splitAmount) / Number(order.totalAmount || 1);

                for (const item of order.items) {
                    if (item.product.isHighEnd && item.managerBonusAmount) {
                        hotBonus += Number(item.managerBonusAmount) * item.quantity * shareRatio;
                    }
                    if (item.isBelowMin) {
                        lowPriceValue += Number(item.totalPrice) * shareRatio;
                    }
                }
                shippingFee += order.deliveries.reduce((ds, d) => ds + Number(d.deliveryFee || 0), 0) * shareRatio;
            }

            lowPriceRatio = totalRevenue > 0 ? (lowPriceValue / totalRevenue) : 0;
            isPenalty = lowPriceRatio >= 0.2;
            isClemency = !!achievedRule && totalRevenue >= Number(achievedRule.targetRevenue) * 1.1;
            actualReward = isPenalty && !isClemency ? baseReward * 0.7 : baseReward;

        } else if (isMarketing) {
            // MARKETING LOGIC: Commission calculated per-branch threshold achievement
            const mRules = await this.prisma.marketingSalaryRule.findMany({ where: { employeeId: id } });
            const rule = mRules[0];

            const allBranchesData = await this.prisma.branch.findMany({
                include: { orders: { where: { isPaymentConfirmed: true, confirmedAt: { gte: startDate, lte: endDate } } } }
            });

            const systemRevenue = allBranchesData.reduce((sum, b) => sum + b.orders.reduce((s, o) => s + Number(o.totalAmount), 0), 0);

            const systemGrossRevAgg = await this.prisma.order.aggregate({
                where: { status: { notIn: ['canceled', 'rejected'] }, orderDate: { gte: orderStartDate, lte: orderEndDate } },
                _sum: { totalAmount: true }
            });

            for (const b of allBranchesData) {
                const bRev = b.orders.reduce((s, o) => s + Number(o.totalAmount), 0);
                if (rule && bRev >= Number(rule.revenueThreshold)) {
                    commission += bRev * (Number(rule.commissionPercent) / 100);
                }
            }

            totalRevenue = systemRevenue;
            grossRevenue = Number(systemGrossRevAgg._sum.totalAmount || 0);
            baseSalary = 6000000; // Default base salary for Marketing
            actualReward = 0;

        } else if (isTelesale) {
            // TELESALE LOGIC
            const systemRevenue = await this.prisma.order.aggregate({
                where: { isPaymentConfirmed: true, confirmedAt: { gte: startDate, lte: endDate } },
                _sum: { totalAmount: true }
            });
            const systemGrossRev = await this.prisma.order.aggregate({
                where: { status: { notIn: ['canceled', 'rejected'] }, orderDate: { gte: orderStartDate, lte: orderEndDate } },
                _sum: { totalAmount: true }
            });
            const sysRev = Number(systemRevenue._sum.totalAmount || 0);
            baseSalary = 6000000;
            commission = sysRev * 0.002;
            totalRevenue = sysRev;
            grossRevenue = Number(systemGrossRev._sum.totalAmount || 0);

        } else if (isDriver) {
            // DRIVER LOGIC
            const driverDeliveries = await this.prisma.delivery.findMany({
                where: { driverId: id, order: { isPaymentConfirmed: true, confirmedAt: { gte: startDate, lte: endDate } } }
            });
            shippingFee = driverDeliveries.reduce((s, d) => s + Number(d.deliveryFee || 0), 0);
            totalOrders = driverDeliveries.length;
            totalRevenue = shippingFee; // For drivers, their "revenue" is their shipping fees
            grossRevenue = shippingFee;

        } else if (isSale) {
            // SALE LOGIC (Existing)
            const salesRules = await this.prisma.salesSalaryRule.findMany({ orderBy: { targetRevenue: 'desc' } });
            const splits = await this.prisma.orderSplit.findMany({
                where: { employeeId: id, order: { isPaymentConfirmed: true, confirmedAt: { gte: startDate, lte: endDate } } },
                include: { order: { include: { items: { include: { product: true } } } } }
            });

            const grossSplits = await this.prisma.orderSplit.findMany({
                where: { employeeId: id, order: { status: { notIn: ['canceled', 'rejected'] }, orderDate: { gte: orderStartDate, lte: orderEndDate } } }
            });
            grossRevenue = grossSplits.reduce((sum, split) => sum + Number(split.splitAmount), 0);

            const processedIds = new Set<string>();
            for (const split of splits) {
                const splitAmount = Number(split.splitAmount);
                totalRevenue += splitAmount;
                processedIds.add(split.orderId);

                const order = split.order;
                const shareRatio = splitAmount / Number(order.totalAmount || 1);

                for (const item of order.items) {
                    if (item.isBelowMin) lowPriceValue += Number(item.totalPrice) * shareRatio;
                    if (item.product.isHighEnd) hotBonus += Number(item.saleBonusAmount) * item.quantity * shareRatio;
                    commission += Number(item.totalPrice) * (item.isBelowMin ? 0.01 : 0.018) * shareRatio;
                }
            }
            totalOrders = processedIds.size;

            const achievedRule = salesRules.find(r => totalRevenue >= Number(r.targetRevenue));
            
            // Lấy lương mặc định từ Chức vụ (nếu có) thay vì gán cứng
            const positionDefaultBaseSalary = Number((employee as any).pos?.baseSalary || 0);

            if (achievedRule) {
                baseReward = Number(achievedRule.bonusAmount);
                baseSalary = Number(achievedRule.baseSalary);
                milestone = Number(achievedRule.targetRevenue);
            } else {
                baseSalary = positionDefaultBaseSalary;
            }

            lowPriceRatio = totalRevenue > 0 ? (lowPriceValue / totalRevenue) : 0;
            isPenalty = lowPriceRatio >= 0.2;
            isClemency = !!achievedRule && totalRevenue >= Number(achievedRule.targetRevenue) * 1.1;
            actualReward = isPenalty && !isClemency ? baseReward * 0.7 : baseReward;

            const driverJobs = await this.prisma.delivery.findMany({
                where: { driverId: id, order: { isPaymentConfirmed: true, confirmedAt: { gte: startDate, lte: endDate } } }
            });
            shippingFee = driverJobs.reduce((s, d) => s + Number(d.deliveryFee || 0), 0);
        }

        // --- TÍNH LƯƠNG CƠ BẢN DỰA TRÊN NGÀY CÔNG ---
        const attendances = await this.prisma.attendance.findMany({
            where: {
                employeeId: id,
                date: { gte: orderStartDate, lte: orderEndDate },
                checkInTime: { not: null }
            }
        });
        actualWorkingDays = attendances.length;
        const rawConfigBaseSalary = (employee as any).customBaseSalary ?? (employee as any).pos?.baseSalary;
        const rawConfigStandardDays = (employee as any).customStandardWorkingDays ?? (employee as any).pos?.standardWorkingDays;

        const effectiveBaseSalary = rawConfigBaseSalary != null ? Number(rawConfigBaseSalary) : baseSalary;
        const effectiveStandardDays = rawConfigStandardDays != null ? Number(rawConfigStandardDays) : 27;

        if (effectiveStandardDays > 0) {
            if (actualWorkingDays >= effectiveStandardDays) {
                baseSalary = effectiveBaseSalary;
            } else {
                baseSalary = (actualWorkingDays / effectiveStandardDays) * effectiveBaseSalary;
            }
        } else {
            baseSalary = effectiveBaseSalary;
        }

        const rawConfigDiligent = (employee as any).customDiligentSalary ?? (employee as any).pos?.diligentSalary;
        const rawConfigAllowance = (employee as any).customAllowance ?? (employee as any).pos?.allowance;

        const effectiveDiligent = rawConfigDiligent != null ? Number(rawConfigDiligent) : 0;
        const effectiveAllowance = rawConfigAllowance != null ? Number(rawConfigAllowance) : 0;

        // Tính Chuyên cần: Phải đạt đủ hoặc vượt công chuẩn mới được hưởng 100% chuyên cần, ngược lại = 0
        if (effectiveStandardDays > 0) {
            diligentSalary = (actualWorkingDays >= effectiveStandardDays) ? effectiveDiligent : 0;
        } else {
            diligentSalary = effectiveDiligent;
        }
        
        // Phụ cấp thường là cố định theo tháng
        allowance = effectiveAllowance;

        const netIncome = baseSalary + commission + hotBonus + shippingFee + actualReward + diligentSalary + allowance;

        return {
            totalOrders,
            grossRevenue,
            totalRevenue,
            lowPriceValue,
            lowPriceRatio: lowPriceRatio * 100,
            milestone,
            baseReward,
            actualReward,
            hotBonus,
            commission,
            shippingFee,
            baseSalary,
            diligentSalary,
            allowance,
            netIncome,
            branchTotalOrders,
            branchTotalRevenue,
            isPenalty,
            isClemency,
            actualWorkingDays,
            effectiveStandardDays,
            effectiveBaseSalary, // Lương CB gốc để frontend hiển thị tooltips hoặc thông tin
        };
    }


    async getPerformanceReport(month: number, year: number, branchId?: string) {
        const employees = await this.prisma.employee.findMany({
            where: {
                status: { not: 'Nghỉ việc' },
                ...(branchId ? { branchId } : {})
            },
            include: { 
                branch: true,
                pos: true,
                dept: true
            }
        });

        const report = [];
        for (const emp of employees) {
            const stats = await this.getPerformanceStats(emp.id, month, year);
            report.push({
                ...stats,
                employeeId: emp.id,
                fullName: emp.fullName,
                branchId: emp.branchId,
                branchName: emp.branch?.name,
                position: (emp as any).pos?.name || emp.position,
                department: (emp as any).dept?.name || emp.department,
                status: emp.status,
                avatarUrl: emp.avatarUrl
            });
        }
        return report;
    }

    async updateAvatar(id: string, avatarUrl: string) {
        const employee = await this.prisma.employee.findUnique({
            where: { id }
        });

        if (!employee) {
            throw new NotFoundException('Employee not found');
        }

        // Xóa ảnh cũ nếu có
        if (employee.avatarUrl) {
            const fs = require('fs');
            const path = require('path');
            const oldImagePath = path.join(process.cwd(), 'public', employee.avatarUrl);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }

        return this.prisma.employee.update({
            where: { id },
            data: { avatarUrl }
        });
    }

    async removeAvatar(id: string) {
        const employee = await this.prisma.employee.findUnique({
            where: { id }
        });

        if (!employee) {
            throw new NotFoundException('Employee not found');
        }

        if (employee.avatarUrl) {
            const fs = require('fs');
            const path = require('path');
            const imagePath = path.join(process.cwd(), 'public', employee.avatarUrl);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        return this.prisma.employee.update({
            where: { id },
            data: { avatarUrl: null }
        });
    }
}
