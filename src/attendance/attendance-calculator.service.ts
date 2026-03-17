import { Injectable } from '@nestjs/common';

export interface AttendanceConfig {
  theme: 'FIXED_TIME' | 'FLEXIBLE' | 'RAW_TRACKING';
  schedule?: {
    is_working_day: boolean;
    start_time: string;
    end_time: string;
    break_start?: string;
    break_end?: string;
    total_standard_hours: number;
  };
  daily_rules?: {
    [key: string]: { // "1" for Monday, "0" for Sunday, etc.
      is_working_day: boolean;
      start_time?: string;
      end_time?: string;
      break_start?: string;
      break_end?: string;
      is_off_day_ot?: boolean;
    }
  };
  attendance_calculation?: {
    base_value: number;
    late_rules?: {
      grace_minutes: number;
      deduction_per_block?: { minutes: number; deduct_value: number };
    };
    early_leave_rules?: {
      grace_minutes: number;
    };
    ignore_late?: boolean;
    ignore_early?: boolean;
    always_full_day?: boolean;
  };
  overtime_rules?: {
    is_allowed: boolean;
    min_minutes_to_trigger: number;
    coefficient: number;
    capped_hours?: number;
    all_weekend_is_ot?: boolean;
    all_off_day_is_ot?: boolean;
  };
  half_day_split?: {
    enabled: boolean;
    morning_end: string;   // Mốc kết thúc ca Sáng, ví dụ "12:00"
    afternoon_start: string; // Mốc bắt đầu ca Chiều, ví dụ "13:30"
    spanning_threshold_minutes?: number; // Ngưỡng lấn ca tối thiểu (mặc định 30)
  };
  location_constraints?: {
    require_gps: boolean;
    allowed_zones?: string[];
    allow_remote?: boolean;
  };
}

export interface AttendanceEvaluationResult {
  totalWorkMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  checkInStatus: string;
  checkOutStatus: string;
  dailyStatus: string;
  workCount: number; // 1.0 = cả ngày, 0.5 = nửa ngày
}

@Injectable()
export class AttendanceCalculatorService {
  /**
   * Lấy lịch làm việc áp dụng cho ngày cụ thể
   */
  private getEffectiveSchedule(config: AttendanceConfig, dateVN: Date) {
    const dayOfWeek = dateVN.getUTCDay();
    const dailyRule = config.daily_rules?.[dayOfWeek.toString()];
    
    if (dailyRule) {
      return {
        is_working_day: dailyRule.is_working_day,
        start_time: dailyRule.start_time || config.schedule?.start_time || '08:00',
        end_time: dailyRule.end_time || config.schedule?.end_time || '17:30',
        break_start: dailyRule.break_start || config.schedule?.break_start,
        break_end: dailyRule.break_end || config.schedule?.break_end,
      };
    }
    
    const schedule = config.schedule || {
      is_working_day: true,
      start_time: '08:00',
      end_time: '17:30'
    };
    
    // Mặc định CN là ngày nghỉ nếu không có cấu hình
    if (dayOfWeek === 0 && !config.schedule) {
       return { ...schedule, is_working_day: false };
    }

    return schedule;
  }

  evaluateCheckIn(
    config: AttendanceConfig,
    checkInTimeUTC: Date,
  ): { checkInStatus: string; lateMinutes: number } {
    if (config.theme === 'RAW_TRACKING' || config.attendance_calculation?.ignore_late) {
      return { checkInStatus: 'ON_TIME', lateMinutes: 0 };
    }

    const inVN = new Date(checkInTimeUTC.getTime() + 7 * 3600000);
    const schedule = this.getEffectiveSchedule(config, inVN);

    if (!schedule.is_working_day) {
      return { checkInStatus: 'ON_TIME', lateMinutes: 0 };
    }

    const [startH, startM] = schedule.start_time.split(':').map(Number);
    const expectedInVN = new Date(inVN);
    expectedInVN.setUTCHours(startH, startM, 0, 0);

    const lateGrace = config.attendance_calculation?.late_rules?.grace_minutes || 0;
    const diffIn = Math.floor((inVN.getTime() - expectedInVN.getTime()) / 60000);

    if (diffIn > lateGrace) {
      return {
        checkInStatus: diffIn > 30 ? 'LATE_SERIOUS' : 'LATE',
        lateMinutes: diffIn,
      };
    }

    return { checkInStatus: 'ON_TIME', lateMinutes: 0 };
  }

  evaluateAttendance(
    config: AttendanceConfig,
    checkInTimeUTC: Date,
    checkOutTimeUTC: Date
  ): AttendanceEvaluationResult {
    const inVN = new Date(checkInTimeUTC.getTime() + 7 * 3600000);
    const outVN = new Date(checkOutTimeUTC.getTime() + 7 * 3600000);
    const schedule = this.getEffectiveSchedule(config, inVN);

    let checkInStatus = 'ON_TIME';
    let checkOutStatus = 'ON_TIME';
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let overtimeMinutes = 0;
    
    let totalWorkMinutes = Math.floor(
      (checkOutTimeUTC.getTime() - checkInTimeUTC.getTime()) / 60000
    );
    if (totalWorkMinutes < 0) totalWorkMinutes = 0;

    if (config.theme === 'RAW_TRACKING') {
      return {
        totalWorkMinutes,
        overtimeMinutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        checkInStatus: 'ON_TIME',
        checkOutStatus: 'ON_TIME',
        dailyStatus: 'FULL_DAY',
        workCount: 1.0,
      };
    }



    // 🚀 PRIORITY LOGIC: Day-Specific Rules first, then Weekend/Off-day global rules
    const dayOfWeek = inVN.getUTCDay();
    const dailyRule = config.daily_rules?.[dayOfWeek.toString()];
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Day-specific OT override
    const isOffDay = !schedule.is_working_day;
    const isDayOT = dailyRule?.is_off_day_ot || false;
    const isWeekendOTGlobal = isWeekend && (config.overtime_rules?.all_weekend_is_ot ?? false);
    
    // Determine if everything should be counted as OT
    // 🚩 FIX: Only should be all OT if it is an OFF day
    const shouldAllBeOT = isOffDay && (
        config.overtime_rules?.is_allowed || 
        isDayOT || 
        isWeekendOTGlobal || 
        config.overtime_rules?.all_off_day_is_ot
    );

    if (shouldAllBeOT) {
      let workMinutes = totalWorkMinutes;
      // Vẫn trừ giờ nghỉ trưa nếu có cấu hình cho ngày này
      if (schedule.break_start && schedule.break_end) {
        const [bStartH, bStartM] = schedule.break_start.split(':').map(Number);
        const [bEndH, bEndM] = schedule.break_end.split(':').map(Number);
        const breakStartVN = new Date(inVN);
        breakStartVN.setUTCHours(bStartH, bStartM, 0, 0);
        const breakEndVN = new Date(inVN);
        breakEndVN.setUTCHours(bEndH, bEndM, 0, 0);

        if (inVN < breakEndVN && outVN > breakStartVN) {
          const actualBreakStart = inVN > breakStartVN ? inVN : breakStartVN;
          const actualBreakEnd = outVN < breakEndVN ? outVN : breakEndVN;
          const breakDeduction = Math.floor((actualBreakEnd.getTime() - actualBreakStart.getTime()) / 60000);
          if (breakDeduction > 0) workMinutes -= breakDeduction;
        }
      }

      overtimeMinutes = workMinutes;
      if (config.overtime_rules?.capped_hours) {
        overtimeMinutes = Math.min(overtimeMinutes, config.overtime_rules.capped_hours * 60);
      }

      return {
        totalWorkMinutes: workMinutes,
        overtimeMinutes,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        checkInStatus: 'ON_TIME',
        checkOutStatus: 'OVERTIME',
        dailyStatus: 'FULL_DAY',
        workCount: 1.0,
      };
    }

    // FIXED_TIME Logic ngày làm việc
    const [startH, startM] = schedule.start_time.split(':').map(Number);
    const [endH, endM] = schedule.end_time.split(':').map(Number);

    const expectedInVN = new Date(inVN);
    expectedInVN.setUTCHours(startH, startM, 0, 0);

    const expectedOutVN = new Date(outVN);
    expectedOutVN.setUTCHours(endH, endM, 0, 0);

    // Late / Early Leave
    const lateGrace = config.attendance_calculation?.late_rules?.grace_minutes || 0;
    const diffIn = Math.floor((inVN.getTime() - expectedInVN.getTime()) / 60000);
    if (diffIn > lateGrace) {
      lateMinutes = diffIn;
      checkInStatus = diffIn > 30 ? 'LATE_SERIOUS' : 'LATE';
    }

    const earlyGrace = config.attendance_calculation?.early_leave_rules?.grace_minutes || 0;
    const diffOut = Math.floor((expectedOutVN.getTime() - outVN.getTime()) / 60000);
    if (diffOut > earlyGrace) {
      earlyLeaveMinutes = diffOut;
      checkOutStatus = 'EARLY_LEAVE';
    }

    // Break time deduction
    if (schedule.break_start && schedule.break_end) {
      const [bStartH, bStartM] = schedule.break_start.split(':').map(Number);
      const [bEndH, bEndM] = schedule.break_end.split(':').map(Number);
      const breakStartVN = new Date(inVN);
      breakStartVN.setUTCHours(bStartH, bStartM, 0, 0);
      const breakEndVN = new Date(inVN);
      breakEndVN.setUTCHours(bEndH, bEndM, 0, 0);

      if (inVN < breakEndVN && outVN > breakStartVN) {
        const actualBreakStart = inVN > breakStartVN ? inVN : breakStartVN;
        const actualBreakEnd = outVN < breakEndVN ? outVN : breakEndVN;
        const breakDeduction = Math.floor((actualBreakEnd.getTime() - actualBreakStart.getTime()) / 60000);
        if (breakDeduction > 0) totalWorkMinutes -= breakDeduction;
      }
    }

    // OT calculation
    // 🚩 FIX: Allow OT if Master Switch is ON OR this specific day allows OT
    const isOTAllowed = config.overtime_rules?.is_allowed || isDayOT;
    
    if (isOTAllowed) {
      const minToTrigger = config.overtime_rules?.min_minutes_to_trigger || 0;
      
      // 🚩 FIX: OT start point should be the LATER of expected end time or actual check-in
      const otStartPoint = Math.max(expectedOutVN.getTime(), inVN.getTime());
      const otDiff = Math.floor((outVN.getTime() - otStartPoint) / 60000);
      
      if (otDiff >= minToTrigger) {
        overtimeMinutes = otDiff;
        checkOutStatus = 'OVERTIME';
      }
    }

    // Apply Capped Hours
    if (config.overtime_rules?.capped_hours) {
      overtimeMinutes = Math.min(overtimeMinutes, config.overtime_rules.capped_hours * 60);
    }

    // 🆕 Tự động nhận diện ca Sáng/Chiều/Hành chính
    let workCount = 1.0;
    let detectedShift = 'FULL_DAY'; // FULL_DAY | HALF_DAY_MORNING | HALF_DAY_AFTERNOON

    if (config.half_day_split?.enabled) {
      const morningEndStr = config.half_day_split.morning_end || '12:00';
      const afternoonStartStr = config.half_day_split.afternoon_start || '13:30';
      
      const [mE_H, mE_M] = morningEndStr.split(':').map(Number);
      const [aS_H, aS_M] = afternoonStartStr.split(':').map(Number);

      // Mốc VN thực tế từ checkin/checkout
      const curInH = (checkInTimeUTC.getUTCHours() + 7) % 24;
      const curInM = checkInTimeUTC.getUTCMinutes();
      const curOutH = (checkOutTimeUTC.getUTCHours() + 7) % 24;
      const curOutM = checkOutTimeUTC.getUTCMinutes();

      // Mốc nhận diện vào ca nào: Nếu vào trước khi kết thúc ca sáng (+ tí ân hạn 15p) -> Coi như bắt đầu từ sáng
      const isStartingMorning = (curInH < mE_H) || (curInH === mE_H && curInM <= mE_M + 15);

      if (isStartingMorning) {
        // Quy tắc: Phải lấn sang ca chiều ít nhất X phút mới tính Hành chính (1.0)
        const spanningThreshold = config.half_day_split.spanning_threshold_minutes ?? 30;
        const afternoonThresholdH = aS_H + Math.floor((aS_M + spanningThreshold) / 60);
        const afternoonThresholdM = (aS_M + spanningThreshold) % 60;
        
        const isSpanningIntoAfternoonSeriously = (curOutH > afternoonThresholdH) || (curOutH === afternoonThresholdH && curOutM >= afternoonThresholdM);
        
        if (isSpanningIntoAfternoonSeriously) {
          workCount = 1.0;
          detectedShift = 'FULL_DAY';
        } else {
          workCount = 0.5;
          detectedShift = 'HALF_DAY_MORNING';
          
          // Khi là Ca Sáng đơn thuần:
          // Trễ tính theo mốc bắt đầu sáng (08:00)
          lateMinutes = Math.max(0, Math.floor((inVN.getTime() - expectedInVN.getTime()) / 60000));
          
          // Sớm tính theo mốc kết thúc sáng (morning_end hoặc break_start)
          const morningLimit = schedule.break_start || morningEndStr;
          const [mlH, mlM] = morningLimit.split(':').map(Number);
          const morningEndLimitVN = new Date(inVN);
          morningEndLimitVN.setUTCHours((mlH - 7 + 24) % 24, mlM, 0, 0);
          
          const earlyGraceHalf = config.attendance_calculation?.early_leave_rules?.grace_minutes || 0;
          const diffOutMorning = Math.floor((morningEndLimitVN.getTime() - checkOutTimeUTC.getTime()) / 60000);
          earlyLeaveMinutes = diffOutMorning > earlyGraceHalf ? diffOutMorning : 0;
          checkOutStatus = earlyLeaveMinutes > 0 ? 'EARLY_LEAVE' : 'ON_TIME';
        }
      } else {
        // Vào ca muộn (sau mốc sáng) -> Mặc định là Ca Chiều
        workCount = 0.5;
        detectedShift = 'HALF_DAY_AFTERNOON';
        
        // Trễ tính theo mốc bắt đầu chiều (afternoon_start)
        const afternoonStartVN = new Date(inVN);
        afternoonStartVN.setUTCHours((aS_H - 7 + 24) % 24, aS_M, 0, 0);
        
        const lateGraceHalf = config.attendance_calculation?.late_rules?.grace_minutes || 0;
        const diffInAfternoon = Math.floor((checkInTimeUTC.getTime() - afternoonStartVN.getTime()) / 60000);
        lateMinutes = diffInAfternoon > lateGraceHalf ? diffInAfternoon : 0;
        checkInStatus = lateMinutes > 30 ? 'LATE_SERIOUS' : (lateMinutes > 0 ? 'LATE' : 'ON_TIME');
        
        // Sớm tính theo mốc kết thúc ngày (17:30)
        earlyLeaveMinutes = Math.max(0, Math.floor((expectedOutVN.getTime() - outVN.getTime()) / 60000));
      }
    }

    // Finalize result based on granular flags or legacy themes
    const isFlexibleTheme = config.theme === 'FLEXIBLE' as any;
    const isRawTheme = config.theme === 'RAW_TRACKING' as any;
    const alwaysFullDay = config.attendance_calculation?.always_full_day;
    const ignoreLate = config.attendance_calculation?.ignore_late;
    const ignoreEarly = config.attendance_calculation?.ignore_early;

    const finalCheckInStatus = ignoreLate ? 'ON_TIME' : checkInStatus;
    const finalCheckOutStatus = ignoreEarly && checkOutStatus === 'EARLY_LEAVE' ? 'ON_TIME' : checkOutStatus;
    const finalLateMinutes = ignoreLate ? 0 : lateMinutes;
    const finalEarlyLeaveMinutes = ignoreEarly ? 0 : earlyLeaveMinutes;

    // Xác định dailyStatus cuối cùng
    let dailyStatus = detectedShift;
    
    // NẾU LÀ HÀNH CHÍNH, LUÔN GIỮ NHÃN FULL_DAY (Hành chính)
    // KHÔNG CÒN GÁN LATE_DAY ĐỂ TRÁNH RỐI MẮT
    // Nếu là nửa công, kể cả có trễ/sớm vẫn giữ nhãn Ca Sáng/Ca Chiều để người dùng dễ theo dõi ca

    // Xử lý logic Theme FLEXIBLE hoặc flag alwaysFullDay
    if (isFlexibleTheme || alwaysFullDay) {
        return {
            totalWorkMinutes,
            overtimeMinutes: isOTAllowed ? overtimeMinutes : 0,
            lateMinutes: (isRawTheme || ignoreLate) ? 0 : finalLateMinutes,
            earlyLeaveMinutes: (isRawTheme || ignoreEarly) ? 0 : finalEarlyLeaveMinutes,
            checkInStatus: (isRawTheme || ignoreLate) ? 'ON_TIME' : finalCheckInStatus,
            checkOutStatus: (isRawTheme || ignoreEarly) ? (overtimeMinutes > 0 ? 'OVERTIME' : 'ON_TIME') : (overtimeMinutes > 0 ? 'OVERTIME' : finalCheckOutStatus),
            dailyStatus: detectedShift === 'FULL_DAY' ? 'FULL_DAY' : detectedShift,
            workCount,
        };
    }

    return {
      totalWorkMinutes,
      overtimeMinutes,
      lateMinutes: finalLateMinutes,
      earlyLeaveMinutes: finalEarlyLeaveMinutes,
      checkInStatus: finalCheckInStatus,
      checkOutStatus: finalCheckOutStatus,
      dailyStatus,
      workCount,
    };
  }
}
