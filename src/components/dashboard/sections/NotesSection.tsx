"use client";

import { useMemo, useState, type ComponentType } from "react";
import { Folder, FileText, DownloadCloud } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import CustomSelect from "@/components/dashboard/CustomSelect";
import type { ExamHistoryEntry, Subject } from "@/lib/studentDetails";
import { getSemesterTabs, hasAnyResourcesForSemester, resolveResourceUrl } from "@/lib/notes/resolveResource";
import type { ResourceTabId } from "@/lib/notes/config";

interface NotesSectionProps {
  usn: string;
  currentSemSubjects: Subject[];
  examHistory: ExamHistoryEntry[];
}

interface SubjectRef {
  code: string;
  name: string;
}

/** Presentational metadata for known tabs; any tab id not listed here still
 * renders correctly using DEFAULT_TAB_META, so a brand-new tab added purely
 * via config.ts works without touching this component. */
const TAB_META: Record<string, { label: string; icon: ComponentType<{ size?: number }>; accent: string; bg: string }> = {
  notes: { label: "Notes", icon: FileText, accent: "var(--accent-primary)", bg: "rgba(99, 102, 241, 0.1)" },
  pyqs: { label: "PYQs", icon: DownloadCloud, accent: "#10b981", bg: "rgba(16, 185, 129, 0.1)" },
};
const DEFAULT_TAB_META = { icon: Folder, accent: "var(--accent-primary)", bg: "rgba(99, 102, 241, 0.1)" };
/** Known tabs render in this order first; any other configured tab id follows, alphabetically. */
const KNOWN_TAB_ORDER = ["notes", "pyqs"];

function orderedTabIds(tabs: Record<ResourceTabId, unknown>): string[] {
  const ids = Object.keys(tabs);
  return ids.sort((a, b) => {
    const ai = KNOWN_TAB_ORDER.indexOf(a);
    const bi = KNOWN_TAB_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? KNOWN_TAB_ORDER.length : ai) - (bi === -1 ? KNOWN_TAB_ORDER.length : bi);
    return a.localeCompare(b);
  });
}

export default function NotesSection({ usn, currentSemSubjects, examHistory }: NotesSectionProps) {
  const branch = useMemo(() => (usn && usn.length >= 7 ? usn.substring(5, 7).toUpperCase() : "Unknown"), [usn]);
  const isLateralEntry = useMemo(() => /4\d{2}$/.test(usn), [usn]);
  const currentSemNumber = useMemo(
    () => (isLateralEntry ? examHistory.length + 3 : examHistory.length + 1),
    [examHistory, isLateralEntry],
  );
  const [selectedSem, setSelectedSem] = useState<number>(currentSemNumber);
  const semOptions = useMemo(
    () =>
      (isLateralEntry ? [3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8]).map((sem) => ({
        value: String(sem),
        label: `Sem ${sem}${sem === currentSemNumber ? " ★" : ""}`,
      })),
    [isLateralEntry, currentSemNumber],
  );

  // Current semester's subjects come from the live scrape; a past semester's
  // subject list is reconstructed from exam_history, which the scraper
  // already attaches code/name to for each course row (see htmlParser.ts).
  const subjectsForSelectedSem: SubjectRef[] = useMemo(() => {
    if (selectedSem === currentSemNumber) {
      return currentSemSubjects.map((s) => ({ code: s.code, name: s.name }));
    }
    const historyIndex = selectedSem - (isLateralEntry ? 3 : 1);
    const entry = examHistory[historyIndex];
    if (!entry) return [];
    return entry.courses
      .filter((c): c is typeof c & { code: string; name: string } => Boolean(c.code) && Boolean(c.name))
      .map((c) => ({ code: c.code, name: c.name }));
  }, [selectedSem, currentSemNumber, currentSemSubjects, examHistory, isLateralEntry]);

  const semesterTabs = useMemo(() => getSemesterTabs(branch, selectedSem), [branch, selectedSem]);
  const hasResources = useMemo(() => hasAnyResourcesForSemester(branch, selectedSem), [branch, selectedSem]);
  const tabIds = useMemo(() => (semesterTabs ? orderedTabIds(semesterTabs) : []), [semesterTabs]);

  return (
    <div className="tab-content">
      <DashboardHeader
        sectionTitle="Notes & PYQs"
        sectionSubtitle={`${branch} Branch Material Explorer`}
        actions={
          <div
            className="notes-sem-selector-wrap"
            style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", justifyContent: "flex-end" }}
          >
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>Semester:</span>
            <CustomSelect
              className="notes-sem-select"
              value={String(selectedSem)}
              options={semOptions}
              onChange={(v) => setSelectedSem(parseInt(v, 10))}
              ariaLabel="Select semester"
            />
          </div>
        }
      />

      {hasResources && subjectsForSelectedSem.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px" }}>
          {subjectsForSelectedSem.map((subj) => {
            const buttons = tabIds
              .map((tabId) => ({ tabId, url: resolveResourceUrl(branch, selectedSem, tabId, subj.code) }))
              .filter((b): b is { tabId: string; url: string } => b.url !== null);

            return (
              <div
                key={subj.code}
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "20px" }}
              >
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "12px", color: "var(--accent-primary)", fontWeight: 600 }}>{subj.code}</div>
                  <div style={{ fontSize: "16px", color: "var(--text-primary)", fontWeight: 600 }}>{subj.name}</div>
                </div>
                {buttons.length > 0 ? (
                  <div style={{ display: "flex", gap: "8px" }}>
                    {buttons.map(({ tabId, url }) => {
                      const meta = TAB_META[tabId] ?? { ...DEFAULT_TAB_META, label: tabId };
                      const Icon = meta.icon;
                      return (
                        <a
                          key={tabId}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            background: meta.bg,
                            color: meta.accent,
                            padding: "8px",
                            borderRadius: "8px",
                            textDecoration: "none",
                            fontSize: "13px",
                            fontWeight: 500,
                          }}
                        >
                          <Icon size={16} /> {meta.label}
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: 0 }}>No resources yet for this subject.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            padding: "28px 20px",
            textAlign: "center",
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Folder size={22} style={{ color: "var(--text-muted)", opacity: 0.6, marginBottom: "2px" }} />
          <h3 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, margin: 0 }}>
            Resources Coming Soon
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: 0, maxWidth: "360px", lineHeight: 1.5 }}>
            {subjectsForSelectedSem.length === 0
              ? `No subject data available for ${branch} Semester ${selectedSem} yet.`
              : `Materials for ${branch} Semester ${selectedSem} are currently being prepared.`}
          </p>
        </div>
      )}
    </div>
  );
}
