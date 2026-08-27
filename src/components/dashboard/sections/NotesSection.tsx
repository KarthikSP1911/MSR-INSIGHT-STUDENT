"use client";

import { useMemo, useState } from "react";
import { Folder, ExternalLink, FileText, DownloadCloud, ChevronRight, AlertCircle } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import type { ExamHistoryEntry, Subject } from "@/lib/studentDetails";
import { DRIVE_LINKS, SUBJECT_LINKS } from "@/lib/notes/notesData";

interface NotesSectionProps {
  studentName: string;
  usn: string;
  currentSemSubjects: Subject[];
  examHistory: ExamHistoryEntry[];
}

export default function NotesSection({ studentName, usn, currentSemSubjects, examHistory }: NotesSectionProps) {
  const branch = useMemo(() => (usn && usn.length >= 7 ? usn.substring(5, 7).toUpperCase() : "Unknown"), [usn]);
  const isLateralEntry = useMemo(() => /4\d{2}$/.test(usn), [usn]);
  const currentSemNumber = useMemo(
    () => (isLateralEntry ? examHistory.length + 3 : examHistory.length + 1),
    [examHistory, isLateralEntry],
  );
  const [selectedSem, setSelectedSem] = useState<number>(currentSemNumber);

  const activeDriveLink = useMemo(() => DRIVE_LINKS[branch]?.[selectedSem] || null, [branch, selectedSem]);
  const availableSems = isLateralEntry ? [3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <div className="tab-content">
      <DashboardHeader
        name={studentName}
        sectionTitle="Notes & PYQs"
        sectionSubtitle={`${branch} Branch Material Explorer`}
        actions={
          <div
            className="notes-sem-selector-wrap"
            style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", justifyContent: "flex-end" }}
          >
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>Semester:</span>
            <select
              value={selectedSem}
              onChange={(e) => setSelectedSem(parseInt(e.target.value))}
              style={{
                padding: "8px 12px",
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                outline: "none",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              {availableSems.map((sem) => (
                <option key={sem} value={sem}>
                  Sem {sem} {sem === currentSemNumber ? "★" : ""}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {activeDriveLink ? (
        <>
          <div
            className="notes-hero-card"
            style={{
              background: "linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)",
              border: "1px solid rgba(99, 102, 241, 0.2)",
              borderRadius: "16px",
              padding: "24px",
              marginBottom: "32px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "20px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1", minWidth: "240px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "var(--accent-primary)",
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  marginBottom: "6px",
                  opacity: 0.8,
                }}
              >
                <span>{branch}</span> <ChevronRight size={12} /> <span>Semester {selectedSem}</span>
              </div>
              <h3 style={{ color: "var(--text-primary)", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: "10px", fontSize: "20px" }}>
                <Folder size={24} style={{ color: "var(--accent-primary)" }} /> Master Folder
              </h3>
              <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "14px", lineHeight: "1.5" }}>
                Access the complete directory of organized notes and PYQs for Semester {selectedSem}.
              </p>
            </div>
            <a
              href={activeDriveLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "white",
                padding: "12px 24px",
                borderRadius: "12px",
                textDecoration: "none",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)",
                whiteSpace: "nowrap",
                width: "fit-content",
              }}
            >
              Open Drive <ExternalLink size={18} />
            </a>
          </div>

          {selectedSem === currentSemNumber ? (
            <>
              <h4 style={{ color: "var(--text-primary)", marginBottom: "16px", fontSize: "18px" }}>Course Specific Materials</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px" }}>
                {currentSemSubjects.map((subj, idx) => {
                  const specificLinks = SUBJECT_LINKS[subj.code];
                  const notesLink = specificLinks?.notes || activeDriveLink;
                  const pyqsLink = specificLinks?.pyqs || activeDriveLink;

                  return (
                    <div key={idx} style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "20px" }}>
                      <div style={{ marginBottom: "16px" }}>
                        <div style={{ fontSize: "12px", color: "var(--accent-primary)", fontWeight: 600 }}>{subj.code}</div>
                        <div style={{ fontSize: "16px", color: "var(--text-primary)", fontWeight: 600 }}>{subj.name}</div>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <a
                          href={notesLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            background: "rgba(99, 102, 241, 0.1)",
                            color: "var(--accent-primary)",
                            padding: "8px",
                            borderRadius: "8px",
                            textDecoration: "none",
                            fontSize: "13px",
                            fontWeight: 500,
                          }}
                        >
                          <FileText size={16} /> Notes
                        </a>
                        <a
                          href={pyqsLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            background: "rgba(16, 185, 129, 0.1)",
                            color: "#10b981",
                            padding: "8px",
                            borderRadius: "8px",
                            textDecoration: "none",
                            fontSize: "13px",
                            fontWeight: 500,
                          }}
                        >
                          <DownloadCloud size={16} /> PYQs
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ padding: "40px 20px", textAlign: "center", background: "rgba(255,255,255,0.02)", borderRadius: "16px", border: "1px dashed var(--border-subtle)" }}>
              <p style={{ color: "var(--text-muted)", margin: 0 }}>
                All resources for <strong>Semester {selectedSem}</strong> are organized within the <strong>Master Folder</strong> above.
              </p>
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            background: "rgba(239, 68, 68, 0.02)",
            borderRadius: "20px",
            border: "1px solid rgba(239, 68, 68, 0.1)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <AlertCircle size={48} color="#EF4444" style={{ marginBottom: "16px", opacity: 0.5 }} />
          <h3 style={{ color: "var(--text-primary)" }}>Resources Coming Soon</h3>
          <p style={{ color: "var(--text-muted)" }}>
            Materials for {branch} Semester {selectedSem} are currently being prepared.
          </p>
        </div>
      )}
    </div>
  );
}
