import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding Departments and Positions...');

    // 1. Departments
    const departments = [
        { name: 'BGĐ', note: 'Ban Giám Đốc' },
        { name: 'MKT', note: 'Phòng Marketing' },
        { name: 'HCKT', note: 'Hành chính Kế toán' },
        { name: 'Kỹ Thuật', note: 'Phòng Kỹ Thuật' },
        { name: 'Kho', note: 'Phòng Kho' },
        { name: 'Lái xe', note: 'Đội Lái xe' },
        { name: 'Phòng KD', note: 'Phòng Kinh Doanh' },
    ];

    console.log('Upserting Departments...');
    for (const d of departments) {
        await prisma.department.upsert({
            where: { name: d.name },
            update: { note: d.note },
            create: { name: d.name, note: d.note },
        });
    }

    // 2. Positions (with default salary settings)
    const positions = [
        { name: 'Giám đốc (GĐ)', baseSalary: 15000000, standardWorkingDays: 27, diligentSalary: 0, allowance: 0 },
        { name: 'Giám đốc kinh doanh (GĐKD)', baseSalary: 15000000, standardWorkingDays: 27, diligentSalary: 0, allowance: 0 },
        { name: 'Nhân viên bán hàng (NVBH)', baseSalary: 8000000, standardWorkingDays: 27, diligentSalary: 1000000, allowance: 500000 },
        { name: 'Nhân viên giao hàng (NVGH)', baseSalary: 7000000, standardWorkingDays: 27, diligentSalary: 500000, allowance: 500000 },
        { name: 'Quản Lý', baseSalary: 12000000, standardWorkingDays: 27, diligentSalary: 1000000, allowance: 1000000 },
        { name: 'Kế toán', baseSalary: 9000000, standardWorkingDays: 27, diligentSalary: 500000, allowance: 500000 },
        { name: 'Nhân viên kỹ thuật (NVKT)', baseSalary: 10000000, standardWorkingDays: 27, diligentSalary: 500000, allowance: 500000 },
        { name: 'Lái xe (Driver)', baseSalary: 8000000, standardWorkingDays: 27, diligentSalary: 500000, allowance: 1000000 },
        { name: 'Marketing', baseSalary: 9000000, standardWorkingDays: 27, diligentSalary: 500000, allowance: 500000 },
    ];

    console.log('Upserting Positions...');
    for (const p of positions) {
        await prisma.position.upsert({
            where: { name: p.name },
            update: {
                baseSalary: p.baseSalary,
                standardWorkingDays: p.standardWorkingDays,
                diligentSalary: p.diligentSalary,
                allowance: p.allowance
            },
            create: {
                name: p.name,
                baseSalary: p.baseSalary,
                standardWorkingDays: p.standardWorkingDays,
                diligentSalary: p.diligentSalary,
                allowance: p.allowance
            },
        });
    }

    // 3. Migrate Legacy Data for Employees
    console.log('Migrating legacy data for employees...');
    const employees = await prisma.employee.findMany();
    for (const emp of employees) {
        let updateData: any = {};
        
        // Map position legacy string to new Position model
        if (emp.position && !emp.positionId) {
            const matchedPos = positions.find(p => p.name.includes(emp.position) || emp.position.includes(p.name));
            if (matchedPos) {
                const posRecord = await prisma.position.findUnique({ where: { name: matchedPos.name } });
                if (posRecord) updateData.positionId = posRecord.id;
            }
        }

        // Map department legacy string to new Department model
        if (emp.department && !emp.departmentId) {
            const matchedDept = departments.find(d => d.name === emp.department);
            if (matchedDept) {
                const deptRecord = await prisma.department.findUnique({ where: { name: matchedDept.name } });
                if (deptRecord) updateData.departmentId = deptRecord.id;
            }
        }

        if (Object.keys(updateData).length > 0) {
            await prisma.employee.update({
                where: { id: emp.id },
                data: updateData
            });
        }
    }

    console.log('Seed and migration finished successfully.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
