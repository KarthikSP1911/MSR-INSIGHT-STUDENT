export interface AttendanceCounts {
  present: number;
  absent: number;
  remaining: number;
}

export interface AttendanceBuffer {
  total: number;
  /**
   * Absences that would still leave attendance at the target. Capped at the classes remaining, because
   * nothing past the remaining classes can be missed. Negative means the target needs more classes
   * attended than are left (see `isReachable`).
   */
  buffer: number;
  /** True when every remaining class could be missed and the target would still hold. */
  coversAllRemaining: boolean;
  /** Attendance % if every remaining class is attended. */
  maxPossiblePct: number;
  isReachable: boolean;
}

export function getAttendanceBuffer({ present, absent, remaining }: AttendanceCounts, targetPct: number): AttendanceBuffer {
  const total = present + absent + remaining;
  const maxPossiblePct = total > 0 ? ((present + remaining) / total) * 100 : 0;
  // Whole-number maths: (targetPct / 100) * total can land a hair above an integer and cost a class.
  const uncapped = Math.floor((100 * (present + remaining) - targetPct * total) / 100);

  return {
    total,
    buffer: Math.min(remaining, uncapped),
    coversAllRemaining: uncapped >= remaining,
    maxPossiblePct,
    isReachable: targetPct <= Math.round(maxPossiblePct),
  };
}
