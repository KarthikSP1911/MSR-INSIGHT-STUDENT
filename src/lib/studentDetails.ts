/** The normalized shape produced by the scraper pipeline (dataNormalizer), stored in students.details. */

export interface AttendanceDetails {
  present: number;
  absent: number;
  remaining: number;
  percentage: number;
  present_dates: string[]; // "DD-MM-YYYY"
  absent_dates: string[];
}

export interface Assessment {
  type: string; // "T1" | "T2" | "T3" | "T4" | "AQ1" | "AQ2" | "AQ3" | "FINAL CIE"
  obtained_marks: number;
  class_average: number;
}

export interface Subject {
  code: string;
  name: string;
  marks: number;
  attendance: number;
  attendance_details: AttendanceDetails;
  assessments: Assessment[];
}

export interface ExamHistoryCourse {
  code?: string;
  name?: string;
  grade: string;
  [key: string]: unknown;
}

export interface ExamHistoryEntry {
  semester: string;
  sgpa: string;
  credits_earned: string;
  courses: ExamHistoryCourse[];
}

export interface RawPlacementEvent {
  title?: string;
  textContent?: string;
  details?: string[];
  actionLink?: string;
  [key: string]: unknown;
}

export interface PlacementData {
  profile?: Record<string, string>;
  eligibilityEvents?: RawPlacementEvent[];
  inProgressEvents?: RawPlacementEvent[];
  completedEvents?: RawPlacementEvent[];
  [key: string]: unknown;
}

export interface StudentDetails {
  usn?: string;
  name?: string;
  class_details?: string;
  cgpa?: string | number;
  last_updated?: string;
  current_year?: number;
  subjects?: Subject[];
  current_semester?: Subject[]; // legacy alias some scrapes produced
  exam_history?: ExamHistoryEntry[];
  placement?: PlacementData | null;
}

export function hasScrapedData(details: StudentDetails | null | undefined): boolean {
  const subjects = details?.subjects ?? details?.current_semester ?? [];
  return subjects.length > 0;
}
