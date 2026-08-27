"use client";

import type { Student } from "@/lib/db/schema";
import type { ExamHistoryEntry, Subject } from "@/lib/studentDetails";

interface PerformanceSectionProps {
  student: Student;
  currentSem: Subject[];
  overallAttendance: number;
  totalCredits: number;
  maxCredits: number;
  currentCgpa: string | null;
  onSelectSubject: (subject: Subject) => void;
  handleUpdate: () => void;
  updateStatus: "loading" | "success" | "error" | null;
  isCooldownActive: boolean;
  formatTime: string;
  examHistory: ExamHistoryEntry[];
  latestSGPA: number;
  sgpaDiff: string;
  isImproved: boolean;
}

// TODO: full port pending (next commit) — placeholder keeps the dashboard shell compiling.
export default function PerformanceSection(_props: PerformanceSectionProps) {
  return <div className="dashboard-section-placeholder">Performance — coming soon</div>;
}
