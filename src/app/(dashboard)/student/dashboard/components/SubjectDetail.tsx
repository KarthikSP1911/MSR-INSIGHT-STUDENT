"use client";

import type { Subject } from "@/lib/studentDetails";

interface SubjectDetailProps {
  subject: Subject;
  allSubjects: Subject[];
  onSubjectChange: (subject: Subject) => void;
  onBack: () => void;
}

// TODO: full port pending (next commit) — placeholder keeps the dashboard shell compiling.
export default function SubjectDetail({ onBack }: SubjectDetailProps) {
  return (
    <div className="dashboard-section-placeholder">
      Subject detail — coming soon
      <button onClick={onBack}>Back</button>
    </div>
  );
}
