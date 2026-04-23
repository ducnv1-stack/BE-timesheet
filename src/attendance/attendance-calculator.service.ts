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
      // 🆕 Support for 2 shifts
      has_shifts?: boolean;
      shift1_end_time?: string;
      shift2_start_time?: string;
      shift1_work_count?: number;
      shift2_work_count?: number;
      work_count?: number; // Cho trường hợp 1 ca nhưng vẫn muốn set công (VD Thứ 7 = 1.0 công)
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

export interface EffectiveSchedule {
  is_working_day: boolean;
  start_time: string;
  end_time: string;
  break_start?: string;
  break_end?: string;
  has_shifts: boolean;
  shift1_end_time?: string;
  shift2_start_time?: string;
  shift1_work_count: number;
  shift2_work_count: number;
  work_count: number;
  total_standard_hours: number;
}

@Injectable()
export class AttendanceCalculatorService {
  /**
   * Lấy lịch làm việc áp dụng cho ngày cụ thể
   */
  private getEffectiveSchedule(config: AttendanceConfig, dateVN: Date): EffectiveSchedule {
    const dayOfWeek = dateVN.getUTCDay();
    const dailyRule = config.daily_rules?.[dayOfWeek.toString()];
    
    if (dailyRule) {
      return {
        is_working_day: dailyRule.is_working_day,
        start_time: dailyRule.start_time || config.schedule?.start_time || '08:00',
        end_time: dailyRule.end_time || config.schedule?.end_time || '17:30',
        break_start: dailyRule.break_start || config.schedule?.break_start,
        break_end: dailyRule.break_end || config.schedule?.break_end,
        has_shifts: dailyRule.has_shifts ?? false,
        shift1_end_time: dailyRule.shift1_end_time,
        shift2_start_time: dailyRule.shift2_start_time,
        shift1_work_count: Number(dailyRule.shift1_work_count ?? 0.5),
        shift2_work_count: Number(dailyRule.shift2_work_count ?? 0.5),
        work_count: Number(dailyRule.work_count ?? 1.0),
        total_standard_hours: Number(config.schedule?.total_standard_hours || 8),
      };
    }
    
    const schedule = config.schedule || {
      is_working_day: true,
      start_time: '08:00',
      end_time: '17:30',
      break_start: undefined,
      break_end: undefined,
      total_standard_hours: 8,
    };
    
    // Mặc định CN là ngày nghỉ nếu không có cấu hình
    const isWorkingDay = dayOfWeek === 0 && !config.schedule ? false : schedule.is_working_day;

    return {
      is_working_day: isWorkingDay,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      break_start: schedule.break_start,
      break_end: schedule.break_end,
      has_shifts: false,
      shift1_end_time: undefined,
      shift2_start_time: undefined,
      shift1_work_count: 0.5,
      shift2_work_count: 0.5,
      work_count: 1.0,
      total_standard_hours: Number(schedule.total_standard_hours || 8),
    };
  }

    evaluateCheckIn(
    config: AttendanceConfig,
    checkInTimeUTC: Date,
  ): { checkInStatus: string; lateMinutes: number } {
    if (!checkInTimeUTC || isNaN(checkInTimeUTC.getTime())) {
      return { checkInStatus: 'ON_TIME', lateMinutes: 0 };
    }
    if (config.theme === 'RAW_TRACKING' || config.attendance_calculation?.ignore_late) {
      return { checkInStatus: 'ON_TIME', lateMinutes: 0 };
    }

    const inVN = new Date(checkInTimeUTC.getTime() + 7 * 3600000);
    const schedule = this.getEffectiveSchedule(config, inVN);

    if (!schedule.is_working_day) {
      return { checkInStatus: 'ON_TIME', lateMinutes: 0 };
    }

    let targetShiftStart = schedule.start_time;
    if (schedule.has_shifts && schedule.shift2_start_time) {
      const [s1H, s1M] = schedule.start_time.split(':').map(Number);
      const [s2H, s2M] = schedule.shift2_start_time.split(':').map(Number);

      const s1Time = new Date(inVN);
      s1Time.setUTCHours(s1H, s1M, 0, 0);

      const s2Time = new Date(inVN);
      s2Time.setUTCHours(s2H, s2M, 0, 0);

      // If check-in is after s1_end_time or closer to s2Time than s1Time, use s2Time
      // A simple rule: if it's after (shift 1 end - threshold), it's shift 2
      const threshold = config.half_day_split?.spanning_threshold_minutes ?? 30;
      const [s1EndH, s1EndM] = (schedule.shift1_end_time || '12:00').split(':').map(Number);
      const s1EndTime = new Date(inVN);
      s1EndTime.setUTCHours(s1EndH, s1EndM, 0, 0);

      if (inVN.getTime() > s1EndTime.getTime() - (threshold * 60000)) {
          targetShiftStart = schedule.shift2_start_time;
      }
    }

    const [startH, startM] = targetShiftStart.split(':').map(Number);
    const expectedInVN = new Date(inVN);
    expectedInVN.setUTCHours(startH, startM, 0, 0);

    const diffIn = Math.floor((inVN.getTime() - expectedInVN.getTime()) / 60000);
    const lateGrace = (config.attendance_calculation?.late_rules?.grace_minutes || 0);

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
    if (!checkInTimeUTC || isNaN(checkInTimeUTC.getTime()) || !checkOutTimeUTC || isNaN(checkOutTimeUTC.getTime())) {
      return {
        totalWorkMinutes: 0,
        overtimeMinutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        checkInStatus: 'ON_TIME',
        checkOutStatus: 'ON_TIME',
        dailyStatus: 'INVALID',
        workCount: 0,
      };
    }
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

    // 🚀 PRIORITY LOGIC: Day-Specific Rules first
    const dayOfWeek = inVN.getUTCDay();
    const dailyRule = config.daily_rules?.[dayOfWeek.toString()];
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Day-specific OT override
    const isOffDay = !schedule.is_working_day;
    const isDayOT = dailyRule?.is_off_day_ot || false;
    const isWeekendOTGlobal = isWeekend && (config.overtime_rules?.all_weekend_is_ot ?? false);
    
    const shouldAllBeOT = isOffDay && (
        config.overtime_rules?.is_allowed || 
        isDayOT || 
        isWeekendOTGlobal || 
        config.overtime_rules?.all_off_day_is_ot
    );

    if (shouldAllBeOT) {
      let workMinutes = totalWorkMinutes;
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

    const lateGrace = config.attendance_calculation?.late_rules?.grace_minutes || 0;
    const earlyGrace = config.attendance_calculation?.early_leave_rules?.grace_minutes || 0;

    // 🆕 Xử lý Logic Chia Ca hoặc Công mặc định
    let workCount = schedule.work_count ?? 1.0;
    let detectedShift = 'FULL_DAY'; // FULL_DAY | HALF_DAY_MORNING | HALF_DAY_AFTERNOON

    if (schedule.has_shifts) {
      const shift1EndStr = schedule.shift1_end_time || '12:00';
      const shift2StartStr = schedule.shift2_start_time || '13:30';

      const [s1E_H, s1E_M] = shift1EndStr.split(':').map(Number);
      const [s2S_H, s2S_M] = shift2StartStr.split(':').map(Number);

      // Nhận diện ca dựa vào "Ngưỡng lấn ca tối thiểu"
      const threshold = config.half_day_split?.spanning_threshold_minutes ?? 30;
      
      const s1EndVN = new Date(inVN);
      s1EndVN.setUTCHours(s1E_H, s1E_M, 0, 0);
      
      const s2StartVN = new Date(inVN);
      s2StartVN.setUTCHours(s2S_H, s2S_M, 0, 0);

      // expectedInVN = s1Start, expectedOutVN = s2End
      // workedS1: Vào trước khi hết ca sáng ít nhất 'threshold' phút VÀ Ra sau khi bắt đầu ca sáng ít nhất 'threshold' phút
      const workedS1 = (inVN.getTime() <= s1EndVN.getTime() - (threshold * 60000)) && (outVN.getTime() >= expectedInVN.getTime() + (threshold * 60000));
      
      // workedS2: Vào trước khi hết ca chiều ít nhất 'threshold' phút VÀ Ra sau khi bắt đầu ca chiều ít nhất 'threshold' phút
      const workedS2 = (inVN.getTime() <= expectedOutVN.getTime() - (threshold * 60000)) && (outVN.getTime() >= s2StartVN.getTime() + (threshold * 60000));

      if (workedS1 && workedS2) {
        workCount = Number(schedule.shift1_work_count || 0.5) + Number(schedule.shift2_work_count || 0.5);
        detectedShift = 'FULL_DAY';
        // Late tính theo start_time, Early tính theo end_time
        const diffIn = Math.floor((inVN.getTime() - expectedInVN.getTime()) / 60000);
        if (diffIn > lateGrace) {
          lateMinutes = diffIn;
          checkInStatus = diffIn > 30 ? 'LATE_SERIOUS' : 'LATE';
        }
        const diffOut = Math.floor((expectedOutVN.getTime() - outVN.getTime()) / 60000);
        if (diffOut > earlyGrace) {
          earlyLeaveMinutes = diffOut;
          checkOutStatus = 'EARLY_LEAVE';
        }
      } else if (workedS1) {
        workCount = Number(schedule.shift1_work_count || 0.5);
        detectedShift = 'HALF_DAY_MORNING';
        // Late tính theo start_time
        const diffIn = Math.floor((inVN.getTime() - expectedInVN.getTime()) / 60000);
        if (diffIn > lateGrace) {
          lateMinutes = diffIn;
          checkInStatus = diffIn > 30 ? 'LATE_SERIOUS' : 'LATE';
        }
        // Early tính theo shift1_end_time
        const s1OutVN = new Date(inVN);
        s1OutVN.setUTCHours(s1E_H, s1E_M, 0, 0);
        const diffOut = Math.floor((s1OutVN.getTime() - outVN.getTime()) / 60000);
        if (diffOut > earlyGrace) {
          earlyLeaveMinutes = diffOut;
          checkOutStatus = 'EARLY_LEAVE';
        }
      } else if (workedS2) {
        workCount = Number(schedule.shift2_work_count || 0.5);
        detectedShift = 'HALF_DAY_AFTERNOON';
        // Late tính theo shift2_start_time
        const s2InVN = new Date(inVN);
        s2InVN.setUTCHours(s2S_H, s2S_M, 0, 0);
        const diffIn = Math.floor((inVN.getTime() - s2InVN.getTime()) / 60000);
        if (diffIn > lateGrace) {
          lateMinutes = diffIn;
          checkInStatus = diffIn > 30 ? 'LATE_SERIOUS' : 'LATE';
        }
        // Early tính theo end_time
        const diffOut = Math.floor((expectedOutVN.getTime() - outVN.getTime()) / 60000);
        if (diffOut > earlyGrace) {
          earlyLeaveMinutes = diffOut;
          checkOutStatus = 'EARLY_LEAVE';
        }
      } else {
        workCount = 0;
        detectedShift = 'ABSENT';
      }
    } else {
      // Logic mặc định cho 1 ca (bao gồm Thứ 7 = 1.0 công)
      const diffIn = Math.floor((inVN.getTime() - expectedInVN.getTime()) / 60000);
      if (diffIn > lateGrace) {
        lateMinutes = diffIn;
        checkInStatus = diffIn > 30 ? 'LATE_SERIOUS' : 'LATE';
      }

      const diffOut = Math.floor((expectedOutVN.getTime() - outVN.getTime()) / 60000);
      if (diffOut > earlyGrace) {
        earlyLeaveMinutes = diffOut;
        checkOutStatus = 'EARLY_LEAVE';
      }
    }

    // Break time deduction (chỉ áp dụng nếu không chia ca hoặc làm cả 2 ca)
    if (schedule.break_start && schedule.break_end && (!schedule.has_shifts || (detectedShift === 'FULL_DAY'))) {
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
    const isOTAllowed = config.overtime_rules?.is_allowed || isDayOT;
    
    if (isOTAllowed) {
      const minToTrigger = config.overtime_rules?.min_minutes_to_trigger || 0;
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

    // Finalize result
    const isFlexibleTheme = config.theme === 'FLEXIBLE' as any;
    const isRawTheme = config.theme === 'RAW_TRACKING' as any;
    const alwaysFullDay = config.attendance_calculation?.always_full_day;
    const ignoreLate = config.attendance_calculation?.ignore_late;
    const ignoreEarly = config.attendance_calculation?.ignore_early;

    const finalCheckInStatus = ignoreLate ? 'ON_TIME' : checkInStatus;
    const finalCheckOutStatus = ignoreEarly && checkOutStatus === 'EARLY_LEAVE' ? 'ON_TIME' : checkOutStatus;
    const finalLateMinutes = ignoreLate ? 0 : lateMinutes;
    const finalEarlyLeaveMinutes = ignoreEarly ? 0 : earlyLeaveMinutes;

    let dailyStatus = detectedShift;
    
    // 🆕 TÍNH CÔNG THEO TỶ LỆ - ĐIỂM CUỐI CÙNG DUY NHẤT
    // Luôn sử dụng totalWorkMinutes đã trừ nghỉ trưa để tính công
    const stdHours = schedule.total_standard_hours || 8;
    const stdMinutes = stdHours * 60;
    const finalWorkCount = Number(Math.min(1.0, totalWorkMinutes / stdMinutes).toFixed(2));

    if (isFlexibleTheme || alwaysFullDay) {
        return {
            totalWorkMinutes,
            overtimeMinutes: isOTAllowed ? overtimeMinutes : 0,
            lateMinutes: (isRawTheme || ignoreLate) ? 0 : finalLateMinutes,
            earlyLeaveMinutes: (isRawTheme || ignoreEarly) ? 0 : finalEarlyLeaveMinutes,
            checkInStatus: (isRawTheme || ignoreLate) ? 'ON_TIME' : finalCheckInStatus,
            checkOutStatus: (isRawTheme || ignoreEarly) ? (overtimeMinutes > 0 ? 'OVERTIME' : 'ON_TIME') : (overtimeMinutes > 0 ? 'OVERTIME' : finalCheckOutStatus),
            dailyStatus: detectedShift === 'FULL_DAY' ? 'FULL_DAY' : detectedShift,
            workCount: finalWorkCount,
        };
    }

    return {
      totalWorkMinutes,
      overtimeMinutes,
      lateMinutes: finalLateMinutes,
      earlyLeaveMinutes: finalEarlyLeaveMinutes,
      checkInStatus: finalCheckInStatus,
      checkOutStatus: finalCheckOutStatus,
      dailyStatus: detectedShift,
      workCount: finalWorkCount,
    };
  }
}
