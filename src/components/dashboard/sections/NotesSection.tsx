"use client";

import type { ExamHistoryEntry, Subject } from "@/lib/studentDetails";

interface NotesSectionProps {
  studentName: string;
  usn: string;
  currentSemSubjects: Subject[];
  examHistory: ExamHistoryEntry[];
}

// TODO: full port pending (next commit) — placeholder keeps the dashboard shell compiling.
export default function NotesSection(_props: NotesSectionProps) {
  return <div className="dashboard-section-placeholder">Notes & PYQs — coming soon</div>;
}
