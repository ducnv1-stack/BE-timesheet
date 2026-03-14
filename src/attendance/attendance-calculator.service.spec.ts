import { AttendanceCalculatorService, AttendanceConfig } from './attendance-calculator.service';

describe('AttendanceCalculatorService', () => {
  let service: AttendanceCalculatorService;

  beforeEach(() => {
    service = new AttendanceCalculatorService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('evaluateAttendance - Khối Sale (FLEXIBLE)', () => {
    it('Phải trả về 1 công (FULL_DAY), 0 OT, ko trễ ko sớm dù check-in giờ nào', () => {
      const config: AttendanceConfig = {
        theme: 'FLEXIBLE',
      };
      
      const inTime = new Date('2023-10-15T07:00:00Z'); // 14:00 VN
      const outTime = new Date('2023-10-15T07:05:00Z'); // 14:05 VN (làm 5 phút)

      const result = service.evaluateAttendance(config, inTime, outTime);

      expect(result.checkInStatus).toBe('ON_TIME');
      expect(result.checkOutStatus).toBe('ON_TIME');
      expect(result.dailyStatus).toBe('FULL_DAY');
      expect(result.totalWorkMinutes).toBe(5);
      expect(result.lateMinutes).toBe(0);
      expect(result.earlyLeaveMinutes).toBe(0);
      expect(result.overtimeMinutes).toBe(0);
    });
  });

  describe('evaluateAttendance - Khối VP (FIXED_TIME có OT)', () => {
    const configVP: AttendanceConfig = {
      theme: 'FIXED_TIME',
      schedule: {
        is_working_day: true,
        start_time: '08:00',
        end_time: '17:30',
        break_start: '12:00',
        break_end: '13:30',
        total_standard_hours: 8,
      },
      attendance_calculation: {
        base_value: 1,
        late_rules: { grace_minutes: 15 },
        early_leave_rules: { grace_minutes: 10 },
      },
      overtime_rules: {
        is_allowed: true,
        min_minutes_to_trigger: 30,
        coefficient: 1.5,
      }
    };

    it('Đi làm chuẩn giờ (đúng 8h-17h30)', () => {
      // 08:00 VN = 01:00 UTC, 17:30 VN = 10:30 UTC
      const inTime = new Date('2023-10-16T01:00:00Z');
      const outTime = new Date('2023-10-16T10:30:00Z');

      const result = service.evaluateAttendance(configVP, inTime, outTime);

      // (10.5 giờ - 1.5 giờ nghỉ) = 9 giờ? wait, 17:30 - 08:00 = 9.5 hours. Break = 1.5 h -> work = 8 hour
      expect(result.totalWorkMinutes).toBe(8 * 60);
      expect(result.lateMinutes).toBe(0);
      expect(result.checkInStatus).toBe('ON_TIME');
      expect(result.overtimeMinutes).toBe(0); // Không làm lố giờ
    });

    it('Đi trễ quá 15 phút ân hạn', () => {
      const inTime = new Date('2023-10-16T01:20:00Z'); // 08:20 VN (muộn 20p)
      const outTime = new Date('2023-10-16T10:30:00Z'); // 17:30 VN

      const result = service.evaluateAttendance(configVP, inTime, outTime);

      expect(result.lateMinutes).toBe(20);
      expect(result.checkInStatus).toBe('LATE');
      expect(result.dailyStatus).toBe('LATE_DAY');
    });

    it('Về trễ 45 phút, được cộng OT', () => {
      const inTime = new Date('2023-10-16T01:00:00Z'); // 08:00 VN
      const outTime = new Date('2023-10-16T11:15:00Z'); // 18:15 VN (về muộn 45p)

      const result = service.evaluateAttendance(configVP, inTime, outTime);

      expect(result.overtimeMinutes).toBe(45);
      expect(result.checkOutStatus).toBe('OVERTIME');
    });

    it('Về trễ 20 phút (không đủ min 30 phút để kích hoạt OT)', () => {
      const inTime = new Date('2023-10-16T01:00:00Z'); // 08:00 VN
      const outTime = new Date('2023-10-16T10:50:00Z'); // 17:50 VN (về muộn 20p)

      const result = service.evaluateAttendance(configVP, inTime, outTime);

      expect(result.overtimeMinutes).toBe(0);
      expect(result.checkOutStatus).toBe('ON_TIME');
    });
  });

  describe('evaluateAttendance - Khối Kỹ Thuật (FIXED_TIME KHÔNG có OT)', () => {
    const configTech: AttendanceConfig = {
      theme: 'FIXED_TIME',
      schedule: {
        is_working_day: true,
        start_time: '08:00',
        end_time: '17:30',
        total_standard_hours: 8,
      },
      overtime_rules: {
        is_allowed: false,
        min_minutes_to_trigger: 30,
        coefficient: 1.5,
      }
    };

    it('Làm tới 20h đêm nhưng vẫn = 0 OT', () => {
      const inTime = new Date('2023-10-16T01:00:00Z'); // 08:00 VN
      const outTime = new Date('2023-10-16T13:00:00Z'); // 20:00 VN

      const result = service.evaluateAttendance(configTech, inTime, outTime);

      expect(result.overtimeMinutes).toBe(0);
      expect(result.checkOutStatus).toBe('ON_TIME'); // Do không áp dụng OT
    });
  });

  describe('evaluateCheckIn', () => {
    it('Phải trả về ON_TIME cho FLEXIBLE', () => {
      const config: AttendanceConfig = { theme: 'FLEXIBLE' };
      const now = new Date();
      const result = service.evaluateCheckIn(config, now);
      expect(result.checkInStatus).toBe('ON_TIME');
      expect(result.lateMinutes).toBe(0);
    });

    it('Tính toán muộn cho FIXED_TIME', () => {
      const config: AttendanceConfig = {
        theme: 'FIXED_TIME',
        schedule: {
          is_working_day: true,
          start_time: '08:00',
          end_time: '17:30',
          total_standard_hours: 8,
        },
        attendance_calculation: {
          base_value: 1,
          late_rules: { grace_minutes: 15 },
        },
      };

      // 08:20 VN = 01:20 UTC
      const inTime = new Date('2023-10-16T01:20:00Z');
      const result = service.evaluateCheckIn(config, inTime);

      expect(result.lateMinutes).toBe(20);
      expect(result.checkInStatus).toBe('LATE');
    });

    it('Nghiêm trọng nếu quá 30p', () => {
      const config: AttendanceConfig = {
        theme: 'FIXED_TIME',
        schedule: {
          is_working_day: true,
          start_time: '08:00',
          end_time: '17:30',
          total_standard_hours: 8,
        },
      };

      // 08:40 VN = 01:40 UTC
      const inTime = new Date('2023-10-16T01:40:00Z');
      const result = service.evaluateCheckIn(config, inTime);

      expect(result.checkInStatus).toBe('LATE_SERIOUS');
    });
  });

  describe('evaluateAttendance - Daily Rules & Off Day OT', () => {
    const configDaily: AttendanceConfig = {
      theme: 'FIXED_TIME',
      daily_rules: {
         "0": { is_working_day: false }, // Sunday: OFF
         "6": { is_working_day: true, start_time: '08:00', end_time: '12:00' } // Saturday: Half day
      },
      overtime_rules: {
        is_allowed: true,
        min_minutes_to_trigger: 0,
        coefficient: 1.5,
        all_off_day_is_ot: true
      }
    };

    it('Đi làm ngày Chủ Nhật (ngày nghỉ) -> Toàn bộ tính OT', () => {
      // 2023-10-15 là Chủ Nhật
      const inTime = new Date('2023-10-15T01:00:00Z'); // 08:00 VN
      const outTime = new Date('2023-10-15T03:00:00Z'); // 10:00 VN (làm 2h)
      const result = service.evaluateAttendance(configDaily, inTime, outTime);
      expect(result.overtimeMinutes).toBe(120);
      expect(result.checkOutStatus).toBe('OVERTIME');
    });

    it('Làm việc Thứ 7 theo khung giờ riêng (8h-12h)', () => {
       // 2023-10-14 là Thứ 7
       const inTime = new Date('2023-10-14T01:00:00Z'); // 08:00 VN
       const outTime = new Date('2023-10-14T05:00:00Z'); // 12:00 VN
       const result = service.evaluateAttendance(configDaily, inTime, outTime);
       expect(result.totalWorkMinutes).toBe(240);
       expect(result.lateMinutes).toBe(0);
       expect(result.overtimeMinutes).toBe(0);
    });
  });
});
