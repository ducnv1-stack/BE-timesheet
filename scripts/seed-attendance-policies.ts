import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Đang khởi tạo các chính sách chấm công mẫu ---');

  // 1. Khối Sale
  const salePolicy = await prisma.attendancePolicy.upsert({
    where: { name: 'Chính sách Khối Sale' },
    update: {},
    create: {
      name: 'Chính sách Khối Sale',
      note: 'T2-T6: Full ngày; T7-CN: 8h-21h30 tính 1 công; Bỏ OT',
    },
  });

  // Days for Sale
  for (let i = 1; i <= 5; i++) {
    await prisma.attendancePolicyDay.upsert({
      where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: salePolicy.id, dayOfWeek: i } },
      update: { startTime: '08:00', endTime: '17:30', isOff: false, allowOT: false, workCount: 1.0 },
      create: { attendancePolicyId: salePolicy.id, dayOfWeek: i, startTime: '08:00', endTime: '17:30', isOff: false, allowOT: false, workCount: 1.0 },
    });
  }
  // T7 (Day 6) & CN (Day 0)
  for (let i of [0, 6]) {
    await prisma.attendancePolicyDay.upsert({
      where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: salePolicy.id, dayOfWeek: i } },
      update: { startTime: '08:00', endTime: '21:30', isOff: false, allowOT: false, workCount: 1.0 },
      create: { attendancePolicyId: salePolicy.id, dayOfWeek: i, startTime: '08:00', endTime: '21:30', isOff: false, allowOT: false, workCount: 1.0 },
    });
  }

  // 2. Khối Văn phòng (VP)
  const vpPolicy = await prisma.attendancePolicy.upsert({
    where: { name: 'Chính sách Khối VP' },
    update: {},
    create: {
      name: 'Chính sách Khối VP',
      note: 'T2-T6: 8h-17h; T7: 8h-12h; Chiều T7-CN: OT 150%',
    },
  });

  for (let i = 1; i <= 5; i++) {
    await prisma.attendancePolicyDay.upsert({
      where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: vpPolicy.id, dayOfWeek: i } },
      update: { startTime: '08:00', endTime: '17:00', isOff: false, allowOT: true, otMultiplier: 1.5, workCount: 1.0 },
      create: { attendancePolicyId: vpPolicy.id, dayOfWeek: i, startTime: '08:00', endTime: '17:00', isOff: false, allowOT: true, otMultiplier: 1.5, workCount: 1.0 },
    });
  }
  // T7 (Day 6)
  await prisma.attendancePolicyDay.upsert({
    where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: vpPolicy.id, dayOfWeek: 6 } },
    update: { startTime: '08:00', endTime: '12:00', isOff: false, allowOT: true, otMultiplier: 1.5, workCount: 1.0 },
    create: { attendancePolicyId: vpPolicy.id, dayOfWeek: 6, startTime: '08:00', endTime: '12:00', isOff: false, allowOT: true, otMultiplier: 1.5, workCount: 1.0 },
  });
  // CN (Day 0)
  await prisma.attendancePolicyDay.upsert({
    where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: vpPolicy.id, dayOfWeek: 0 } },
    update: { startTime: '08:00', endTime: '08:00', isOff: true, allowOT: true, otMultiplier: 1.5, workCount: 0 },
    create: { attendancePolicyId: vpPolicy.id, dayOfWeek: 0, startTime: '08:00', endTime: '08:00', isOff: true, allowOT: true, otMultiplier: 1.5, workCount: 0 },
  });

  // 3. Khối Kỹ thuật
  const techPolicy = await prisma.attendancePolicy.upsert({
    where: { name: 'Chính sách Khối Kỹ thuật' },
    update: {},
    create: {
      name: 'Chính sách Khối Kỹ thuật',
      note: 'T2-T6: 8h-17h30; T7: 8h-12h; Không OT; Không GPS',
    },
  });

  for (let i = 1; i <= 5; i++) {
    await prisma.attendancePolicyDay.upsert({
      where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: techPolicy.id, dayOfWeek: i } },
      update: { startTime: '08:00', endTime: '17:30', isOff: false, allowOT: false, requireGPS: false, workCount: 1.0 },
      create: { attendancePolicyId: techPolicy.id, dayOfWeek: i, startTime: '08:00', endTime: '17:30', isOff: false, allowOT: false, requireGPS: false, workCount: 1.0 },
    });
  }
  // T7 (Day 6)
  await prisma.attendancePolicyDay.upsert({
    where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: techPolicy.id, dayOfWeek: 6 } },
    update: { startTime: '08:00', endTime: '12:00', isOff: false, allowOT: false, requireGPS: false, workCount: 1.0 },
    create: { attendancePolicyId: techPolicy.id, dayOfWeek: 6, startTime: '08:00', endTime: '12:00', isOff: false, allowOT: false, requireGPS: false, workCount: 1.0 },
  });
  // CN (Day 0)
  await prisma.attendancePolicyDay.upsert({
    where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: techPolicy.id, dayOfWeek: 0 } },
    update: { isOff: true, workCount: 0 },
    create: { attendancePolicyId: techPolicy.id, dayOfWeek: 0, startTime: '08:00', endTime: '08:00', isOff: true, workCount: 0 },
  });

  // 4. Khối Kho
  const warehousePolicy = await prisma.attendancePolicy.upsert({
    where: { name: 'Chính sách Khối Kho' },
    update: {},
    create: {
      name: 'Chính sách Khối Kho',
      note: '8h-17h kể cả T7-CN: tính 1 công, không tính OT; Set GPS riêng',
      // Giả sử GPS của kho (có thể cập nhật sau)
    },
  });

  for (let i = 0; i <= 6; i++) {
    await prisma.attendancePolicyDay.upsert({
      where: { attendancePolicyId_dayOfWeek: { attendancePolicyId: warehousePolicy.id, dayOfWeek: i } },
      update: { startTime: '08:00', endTime: '17:00', isOff: false, allowOT: false, workCount: 1.0 },
      create: { attendancePolicyId: warehousePolicy.id, dayOfWeek: i, startTime: '08:00', endTime: '17:00', isOff: false, allowOT: false, workCount: 1.0 },
    });
  }

  console.log('--- Đã khởi tạo thành công 4 nhóm chính sách mẫu ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
