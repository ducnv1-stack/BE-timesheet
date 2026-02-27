import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugUpdateDetailed() {
    const id = '2dc52c43-01db-416e-82c5-bb775f29e89a';
    console.log(`Starting detailed debug for employee ID: ${id}`);

    try {
        // Mocking the DTO from the screenshot
        const updateEmployeeDto = {
            fullName: "Đặng Viết Hoàng",
            phone: "0982474114",
            branchId: "bc7c4b34-9792-48ab-8807-15005d0ee8af",
            position: "NVBH",
            department: "Phòng KD",
            birthday: "2000-01-17",
            gender: "Nam",
            status: "Đang làm việc",
            workingType: "Full time 8 tiếng",
            email: "hoangquanohari1799@gmail.com",
            idCardNumber: "",
            permanentAddress: ""
        };

        console.log('1. Fetching current employee...');
        const employee = await prisma.employee.findUnique({
            where: { id },
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

        if (!employee) {
            console.error('Employee not found!');
            return;
        }
        console.log('Employee found:', employee.fullName);

        console.log('2. Processing update data...');
        const { branchId, ...updateData } = updateEmployeeDto;

        if (updateData.birthday) {
            (updateData as any).birthMonth = new Date(updateData.birthday).getMonth() + 1;
            console.log('Calculated birthMonth:', (updateData as any).birthMonth);
        }

        console.log('3. Executing Prisma update...');
        const updated = await prisma.employee.update({
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

        console.log('4. Update success!');
        console.log('Result:', JSON.stringify(updated, null, 2));

    } catch (error: any) {
        console.error('FAILED during debug:');
        console.error('Error Code:', error.code);
        console.error('Error Message:', error.message);
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

debugUpdateDetailed();
