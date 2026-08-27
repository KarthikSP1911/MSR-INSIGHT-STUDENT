import type { Subject } from "@/lib/studentDetails";

export interface HeatmapDay {
  dateStr: string;
  niceDate: string;
  present: number;
  absent: number;
  presentSubjects: string[];
  absentSubjects: string[];
  dayIdx: number; // Monday = 0 ... Sunday = 6
  month: string;
}

export const HEATMAP_COLORS: Record<number, string> = {
  [-1]: "#EF4444",
  0: "#1e293b",
  1: "#064e3b",
  2: "#065f46",
  3: "#059669",
  4: "#10b981",
};

/** Intensity level for a day's present/absent counts, mapped to HEATMAP_COLORS. */
export function getHeatmapLevel(present: number, absent: number): number {
  if (present === 0 && absent === 0) return 0;
  if (present === 0 && absent > 0) return -1;
  if (present === 1) return 1;
  if (present === 2) return 2;
  if (present === 3) return 3;
  return 4;
}

function parseDdMmYyyy(s: string): number {
  const [d, m, y] = s.split("-");
  return new Date(`${y}-${m}-${d}`).getTime();
}

/**
 * Builds a Monday-start GitHub-style week grid spanning every present/absent
 * date across `currentSem`'s subjects, one column per week, aggregating
 * attendance across all subjects for each calendar day.
 */
export function buildHeatmapWeeks(currentSem: Subject[]): HeatmapDay[][] {
  const attendanceMap: Record<
    string,
    { present: number; absent: number; presentSubjects: string[]; absentSubjects: string[] }
  > = {};
  const allTimepoints: number[] = [];

  currentSem.forEach((subj) => {
    (subj.attendance_details?.present_dates || []).forEach((d) => {
      allTimepoints.push(parseDdMmYyyy(d));
      if (!attendanceMap[d]) attendanceMap[d] = { present: 0, absent: 0, presentSubjects: [], absentSubjects: [] };
      attendanceMap[d].present += 1;
      attendanceMap[d].presentSubjects.push(subj.name);
    });
    (subj.attendance_details?.absent_dates || []).forEach((d) => {
      allTimepoints.push(parseDdMmYyyy(d));
      if (!attendanceMap[d]) attendanceMap[d] = { present: 0, absent: 0, presentSubjects: [], absentSubjects: [] };
      attendanceMap[d].absent += 1;
      attendanceMap[d].absentSubjects.push(subj.name);
    });
  });

  const now = new Date();
  const sixMonthsAgo = now.getTime() - 180 * 86400000;
  const minTime = allTimepoints.length ? Math.min(...allTimepoints) : sixMonthsAgo;
  const maxTime = allTimepoints.length ? Math.max(...allTimepoints) : now.getTime();

  const startDate = new Date(minTime);
  startDate.setDate(1); // Start from the 1st of the month data begins
  const startDay = startDate.getDay();
  const diffToMon = startDay === 0 ? 6 : startDay - 1;
  startDate.setDate(startDate.getDate() - diffToMon);

  const endDate = new Date(maxTime);

  const calculatedWeeks: HeatmapDay[][] = [];
  let currentWeek: HeatmapDay[] = [];
  const iterDate = new Date(startDate);

  while (iterDate <= endDate || currentWeek.length > 0) {
    const dayOfWeekIdx = iterDate.getDay();
    const shiftedIdx = dayOfWeekIdx === 0 ? 6 : dayOfWeekIdx - 1; // Mon=0, Sun=6

    const dStr = `${String(iterDate.getDate()).padStart(2, "0")}-${String(iterDate.getMonth() + 1).padStart(2, "0")}-${iterDate.getFullYear()}`;
    const stats = attendanceMap[dStr] || { present: 0, absent: 0, presentSubjects: [], absentSubjects: [] };

    currentWeek.push({
      dateStr: dStr,
      niceDate: iterDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      present: stats.present,
      absent: stats.absent,
      presentSubjects: stats.presentSubjects,
      absentSubjects: stats.absentSubjects,
      dayIdx: shiftedIdx,
      month: iterDate.toLocaleDateString("en-US", { month: "short" }),
    });

    if (shiftedIdx === 6) {
      calculatedWeeks.push(currentWeek);
      currentWeek = [];
      if (iterDate >= endDate) break;
    }
    iterDate.setDate(iterDate.getDate() + 1);
  }

  return calculatedWeeks;
}
