import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Attendance Policy Migration to JSON Config...');

  const policies = await prisma.attendancePolicy.findMany({
    include: { days: true },
  });

  for (const policy of policies) {
    if (policy.configData) {
      console.log(`⏩ Skipping policy: ${policy.name} (Already has configData)`);
      continue;
    }

    console.log(`📦 Migrating policy: ${policy.name}...`);

    // Lấy ngày làm việc đầu tiên để làm template schedule
    const firstWorkingDay = policy.days.find((d) => !d.isOff) || policy.days[0];

    const configData = {
      theme: 'FIXED_TIME', // Mặc định là Fixed Time cho các bản ghi cũ
      schedule: firstWorkingDay
        ? {
            is_working_day: !firstWorkingDay.isOff,
            start_time: firstWorkingDay.startTime,
            end_time: firstWorkingDay.endTime,
            total_standard_hours: 8,
          }
        : undefined,
      attendance_calculation: {
        base_value: 1,
        late_rules: { grace_minutes: 15 },
        early_leave_rules: { grace_minutes: 15 },
      },
      overtime_rules: {
        is_allowed: policy.days.some((d) => d.allowOT),
        min_minutes_to_trigger: 30,
        coefficient: 1.5,
      },
      location_constraints: {
        require_gps: policy.requireGPS,
      },
    };

    await prisma.attendancePolicy.update({
      where: { id: policy.id },
      data: { configData },
    });

    console.log(`✅ Migrated policy: ${policy.name}`);
  }

  console.log('🎉 Migration completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
