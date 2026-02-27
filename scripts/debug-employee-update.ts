import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugUpdate() {
    const id = '2dc52c43-01db-416e-82c5-bb775f29e89a';
    console.log(`Testing update for employee ID: ${id}`);

    try {
        const updateData = {
            fullName: 'Đặng Viết Hoàng',
            phone: '0982474114',
            position: 'NVBH',
            department: 'Phòng KD',
            birthday: '2000-01-17T00:00:00.000Z',
            gender: 'Nam',
            status: 'Đang làm việc',
            workingType: 'Full time 8 tiếng',
            email: 'hoangquanohari1799@gmail.com',
            idCardNumber: '',
            permanentAddress: '',
        };

        const updated = await prisma.employee.update({
            where: { id },
            data: {
                ...updateData,
                birthday: new Date(updateData.birthday),
                birthMonth: new Date(updateData.birthday).getMonth() + 1,
            }
        });

        console.log('Update successful:', updated.fullName);
    } catch (error) {
        console.error('Update failed with error:');
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

debugUpdate();
