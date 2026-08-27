"use client";

import type { Subject } from "@/lib/studentDetails";

interface SimulatorSectionProps {
  studentName: string;
  currentSem: Subject[];
  predictedGrades: Record<string, string>;
  simulatedCredits: Record<string, number>;
  setPredictedGrades: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSimulatedCredits: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  currentCgpa: string | null;
  totalCredits: number;
  GRADE_COLORS: Record<string, string>;
  GRADE_POINTS: Record<string, number>;
}

// TODO: full port pending (next commit) — placeholder keeps the dashboard shell compiling.
export default function SimulatorSection(_props: SimulatorSectionProps) {
  return <div className="dashboard-section-placeholder">Simulator — coming soon</div>;
}
