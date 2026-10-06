"use client";

import { History } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import CustomSelect from "@/components/dashboard/CustomSelect";
import { UpdateButton } from "@/components/dashboard/UpdateButton";
import type { ExamHistoryEntry } from "@/lib/studentDetails";

interface HistorySectionProps {
  examHistory: ExamHistoryEntry[];
  selectedHistoryIdx: number;
  setSelectedHistoryIdx: (idx: number) => void;
  GRADE_COLORS: Record<string, string>;
  isLateralEntry?: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  refreshCooldownActive: boolean;
  refreshCooldownLabel: string;
}

export default function HistorySection({
  examHistory,
  selectedHistoryIdx,
  setSelectedHistoryIdx,
  GRADE_COLORS,
  isLateralEntry = false,
  onRefresh,
  isRefreshing,
  refreshCooldownActive,
  refreshCooldownLabel,
}: HistorySectionProps) {
  const refreshButton = (
    <UpdateButton
      onClick={onRefresh}
      isLoading={isRefreshing}
      cooldownActive={refreshCooldownActive}
      formattedCooldown={refreshCooldownLabel}
      label="Refresh results"
      loadingLabel="Refreshing..."
      title="Fetch your latest exam results from the portal"
    />
  );

  if (examHistory.length === 0) {
    return (
      <div className="tab-content">
        <DashboardHeader
        sectionTitle="Exam History"
        sectionSubtitle="Complete record of your academic performance"
        actions={refreshButton}
      />
        <div className="empty-history">
          <History size={48} color="var(--text-muted)" />
          <h3>No exam history available</h3>
        </div>
      </div>
    );
  }

  const reversedHistory = [...examHistory].reverse();

  return (
    <div className="tab-content">
      <DashboardHeader
        sectionTitle="Exam History"
        sectionSubtitle="Complete record of your academic performance"
        actions={refreshButton}
      />

      <div className="history-tab-container">
        <div className="mobile-history-selector">
          <span className="stat-label mobile-history-label">Select Semester</span>
          <CustomSelect
            className="history-sem-select"
            menuClassName="history-sem-menu"
            maxMenuHeight={320}
            ariaLabel="Select semester"
            value={String(selectedHistoryIdx)}
            onChange={(v) => setSelectedHistoryIdx(parseInt(v, 10))}
            options={reversedHistory.map((sem, idx) => {
              const semNum = isLateralEntry ? examHistory.length - idx + 2 : examHistory.length - idx;
              return { value: String(idx), label: `Semester ${semNum} (SGPA: ${sem.sgpa})` };
            })}
          />
        </div>

        <div className="history-grid">
          {reversedHistory.map((sem, idx) => (
            <div key={idx} className={`chart-card history-card ${selectedHistoryIdx === idx ? "mobile-show" : "mobile-hide"}`}>
              <div
                className="chart-header"
                style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  paddingBottom: "16px",
                  marginBottom: "16px",
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <div>
                  <span className="pill" style={{ marginBottom: "8px", display: "inline-block" }}>
                    Semester {isLateralEntry ? examHistory.length - idx + 2 : examHistory.length - idx}
                  </span>
                  <h3 className="chart-title" style={{ margin: 0 }}>
                    {sem.semester}
                  </h3>
                </div>
                <div className="history-sgpa-badge" style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="stat-label" style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    SGPA
                  </div>
                  <div className="stat-value" style={{ fontSize: "24px", fontWeight: 800, color: "var(--accent-primary)", lineHeight: 1 }}>
                    {sem.sgpa}
                  </div>
                </div>
              </div>
              <div className="dashboard-table-container history-table-container">
                <table className="dashboard-table history-table">
                  <thead>
                    <tr>
                      <th className="history-col-code">Code</th>
                      <th className="history-col-course">Course</th>
                      <th className="history-col-mobile-merged" style={{ display: "none" }}>Course</th>
                      <th className="history-col-grade" style={{ textAlign: "right", width: "70px" }}>Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sem.courses?.map((c, i) => (
                      <tr key={i}>
                        <td className="history-col-code" style={{ color: "var(--text-muted)", fontSize: "12px" }}>{c.code}</td>
                        <td className="history-col-course" style={{ fontSize: "13px" }}>{c.name}</td>
                        <td className="history-col-mobile-merged" style={{ display: "none" }}>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>{c.code}</div>
                          <div style={{ fontSize: "12px", lineHeight: "1.3", wordBreak: "break-word", whiteSpace: "normal" }}>{c.name}</div>
                        </td>
                        <td className="history-col-grade" style={{ textAlign: "right", fontWeight: "bold", color: GRADE_COLORS[c.grade] || "var(--text-primary)" }}>
                          {c.grade}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
