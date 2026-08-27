"use client";

import { useState, useMemo } from "react";
import { Sparkles, Calendar } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import type { Subject } from "@/lib/studentDetails";
import { computeGradeProjection } from "@/lib/simulator/gradeMath";
import { buildHeatmapWeeks, getHeatmapLevel, HEATMAP_COLORS, type HeatmapDay } from "@/lib/simulator/heatmapDates";

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

export default function SimulatorSection({
  studentName,
  currentSem,
  predictedGrades,
  simulatedCredits,
  setPredictedGrades,
  setSimulatedCredits,
  currentCgpa,
  totalCredits,
  GRADE_COLORS,
  GRADE_POINTS,
}: SimulatorSectionProps) {
  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<HeatmapDay | null>(null);

  const { projSGPA, projCGPA } = useMemo(
    () =>
      computeGradeProjection({
        currentSem,
        simulatedCredits,
        predictedGrades,
        totalCredits,
        currentCgpa,
        GRADE_POINTS,
      }),
    [currentSem, simulatedCredits, predictedGrades, totalCredits, currentCgpa, GRADE_POINTS],
  );

  const weeks = useMemo(() => buildHeatmapWeeks(currentSem), [currentSem]);

  return (
    <div className="tab-content">
      <DashboardHeader
        name={studentName}
        sectionTitle="Interactive Simulator"
        sectionSubtitle="Experiment with your grades and explore your global attendance"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div className="chart-card predictor-card">
          <div className="chart-header">
            <h3 className="chart-title">
              <Sparkles size={18} style={{ display: "inline", color: "#10b981", marginRight: "6px", verticalAlign: "-3px" }} /> &quot;What-If&quot;
              Predictor
            </h3>
            <p className="chart-subtitle">Precision Grade &amp; Credit Simulation</p>
          </div>
          <div className="predictor-container">
            <div className="predictor-layout">
              <div className="predictor-scoreboard">
                <div className="score-item sgpa">
                  <div className="score-label">Projected SGPA</div>
                  <div className="score-value">{projSGPA.toFixed(2)}</div>
                </div>
                <div className="score-divider" />
                <div className="score-item cgpa">
                  <div className="score-label">Projected CGPA</div>
                  <div className="score-value">{projCGPA.toFixed(2)}</div>
                </div>
              </div>

              <div className="predictor-controls">
                <div className="controls-header">
                  <span>Subject</span>
                  <div className="controls-labels">
                    <span className="label-credits">Credits</span>
                    <span className="label-grade">Grade</span>
                  </div>
                </div>
                <div className="controls-scrollable">
                  {currentSem.map((subj) => {
                    const currentGrade = predictedGrades[subj.code] || "O";
                    return (
                      <div key={subj.code} className="subject-row">
                        <div className="subj-info">
                          <div className="subj-name" title={subj.name}>
                            {subj.name}
                          </div>
                          <div className="subj-code">{subj.code}</div>
                        </div>
                        <div className="subj-pickers">
                          <select
                            value={simulatedCredits[subj.code] ?? 4}
                            onChange={(e) =>
                              setSimulatedCredits({ ...simulatedCredits, [subj.code]: parseInt(e.target.value) })
                            }
                            className="simulator-select credit-select"
                          >
                            {[0, 1, 2, 3, 4, 5].map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          <select
                            value={currentGrade}
                            onChange={(e) => setPredictedGrades({ ...predictedGrades, [subj.code]: e.target.value })}
                            className="simulator-select grade-select"
                            style={{ color: GRADE_COLORS[currentGrade] }}
                          >
                            {Object.keys(GRADE_POINTS).map((g) => (
                              <option key={g} value={g} style={{ color: "#fff", background: "#1e293b" }}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="chart-card wide-chart">
          <div className="chart-header">
            <h3 className="chart-title">
              <Calendar size={18} style={{ display: "inline", color: "#10b981", marginRight: "6px", verticalAlign: "-3px" }} /> Global
              Attendance Heatmap
            </h3>
          </div>
          <div className="chart-body" style={{ overflowX: "auto", padding: "10px 0" }}>
            <div className="github-heatmap-container">
              <div className="heatmap-header-row">
                <div className="day-label-cols" />
                <div className="weeks-labels-container">
                  {weeks.map((w, idx) => {
                    const showMonth = idx === 0 || w[0].month !== weeks[idx - 1][0].month;
                    return (
                      <div key={idx} className="month-label-col">
                        {showMonth ? <span className="month-name-tag">{w[0].month}</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="heatmap-grid-core">
                <div className="day-labels">
                  <span>Mon</span>
                  <span>Tue</span>
                  <span>Wed</span>
                  <span>Thu</span>
                  <span>Fri</span>
                  <span>Sat</span>
                  <span>Sun</span>
                </div>
                <div className="weeks-container">
                  {weeks.map((week, wIdx) => (
                    <div key={wIdx} className="heatmap-column">
                      {Array.from({ length: 7 }).map((_, dIdx) => {
                        const day = week.find((d) => d.dayIdx === dIdx);
                        if (!day) return <div key={dIdx} className="heatmap-square empty" />;
                        const level = getHeatmapLevel(day.present, day.absent);
                        const isSelected = selectedHeatmapDay?.dateStr === day.dateStr;
                        return (
                          <div
                            key={dIdx}
                            className={`heatmap-square level-${level}`}
                            style={{
                              background: HEATMAP_COLORS[level],
                              cursor: "pointer",
                              outline: isSelected ? "2px solid #fff" : "none",
                              zIndex: isSelected ? 10 : 1,
                            }}
                            title={`${day.niceDate}: ${day.present} present, ${day.absent} absent`}
                            onClick={() => setSelectedHeatmapDay(day)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="heatmap-footer">
                <div className="legend">
                  <span>Less</span>
                  <div className="heatmap-square" style={{ background: HEATMAP_COLORS[0] }} />
                  <div className="heatmap-square" style={{ background: HEATMAP_COLORS[1] }} />
                  <div className="heatmap-square" style={{ background: HEATMAP_COLORS[2] }} />
                  <div className="heatmap-square" style={{ background: HEATMAP_COLORS[3] }} />
                  <div className="heatmap-square" style={{ background: HEATMAP_COLORS[4] }} />
                  <span>More</span>
                </div>
              </div>
            </div>

            {selectedHeatmapDay && (
              <div className="heatmap-details-panel">
                <div className="details-header">
                  <h4 className="details-title">Details for {selectedHeatmapDay.niceDate}</h4>
                  <button className="close-details" onClick={() => setSelectedHeatmapDay(null)}>
                    &times;
                  </button>
                </div>
                <div className="details-content">
                  <div className="details-section">
                    <div className="section-title" style={{ color: "#10b981" }}>
                      Attended ({selectedHeatmapDay.present})
                    </div>
                    {selectedHeatmapDay.presentSubjects.length > 0 ? (
                      <ul className="subject-list">
                        {selectedHeatmapDay.presentSubjects.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="no-data">No classes attended</p>
                    )}
                  </div>
                  <div className="details-section">
                    <div className="section-title" style={{ color: "#ef4444" }}>
                      Missed ({selectedHeatmapDay.absent})
                    </div>
                    {selectedHeatmapDay.absentSubjects.length > 0 ? (
                      <ul className="subject-list">
                        {selectedHeatmapDay.absentSubjects.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="no-data">No classes missed</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
