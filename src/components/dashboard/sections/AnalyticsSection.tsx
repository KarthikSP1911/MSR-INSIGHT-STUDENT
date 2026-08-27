"use client";

import type { StudentDetails } from "@/lib/studentDetails";

interface AnalyticsSectionProps {
  studentName: string;
  internalComparisonData: { code: string; name: string; studentScore: number; classAverage: number }[];
  gradeChartData: { grade: string; count: number; color: string }[];
  bestSubject: unknown;
  weakestSubject: unknown;
  overallAttendance: number;
  detailsBlob: StudentDetails;
  latestSGPA: number;
  sgpaDiffValue: number;
  sgpaTrendData: { name: string; sgpa: number; credits: number }[];
}

// TODO: full port pending (next commit) — placeholder keeps the dashboard shell compiling.
export default function AnalyticsSection(_props: AnalyticsSectionProps) {
  return <div className="dashboard-section-placeholder">Analytics — coming soon</div>;
}
