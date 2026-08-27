"use client";

import type { ExamHistoryEntry } from "@/lib/studentDetails";

interface HistorySectionProps {
  studentName: string;
  examHistory: ExamHistoryEntry[];
  selectedHistoryIdx: number;
  setSelectedHistoryIdx: (idx: number) => void;
  GRADE_COLORS: Record<string, string>;
  isLateralEntry?: boolean;
}

// TODO: full port pending (next commit) — placeholder keeps the dashboard shell compiling.
export default function HistorySection(_props: HistorySectionProps) {
  return <div className="dashboard-section-placeholder">Exam History — coming soon</div>;
}
