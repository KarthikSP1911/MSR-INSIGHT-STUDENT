"use client";

import { useState, useMemo } from "react";
import { Sparkles, Calculator } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import CustomSelect from "@/components/dashboard/CustomSelect";
import type { ExamHistoryEntry, Subject } from "@/lib/studentDetails";
import { computeGradeProjection } from "@/lib/simulator/gradeMath";
import { computeCreditWeightedCgpa, type CgpaSemesterEntry } from "@/lib/simulator/cgpaCalculator";

interface SimulatorSectionProps {
  currentSem: Subject[];
  predictedGrades: Record<string, string>;
  simulatedCredits: Record<string, number>;
  setPredictedGrades: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSimulatedCredits: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  currentCgpa: string | null;
  totalCredits: number;
  GRADE_COLORS: Record<string, string>;
  GRADE_POINTS: Record<string, number>;
  examHistory: ExamHistoryEntry[];
  isLateralEntry: boolean;
}

export default function SimulatorSection({
  currentSem,
  predictedGrades,
  simulatedCredits,
  setPredictedGrades,
  setSimulatedCredits,
  currentCgpa,
  totalCredits,
  GRADE_COLORS,
  GRADE_POINTS,
  examHistory,
  isLateralEntry,
}: SimulatorSectionProps) {
  const [sgpaOverrides, setSgpaOverrides] = useState<Record<number, string>>({});

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

  // Degree is 8 semesters (6 for a lateral-entry student, who joins at semester 3 — same
  // convention already used for Notes & PYQs' semester list). Each slot's default SGPA/credits
  // come from the real scraped exam_history for that semester when it's already completed;
  // nothing here is invented.
  const semesterDefaults = useMemo(() => {
    const semNumbers = isLateralEntry ? [3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
    const map: Record<number, { sgpa: string; credits: number | null }> = {};
    for (const semNum of semNumbers) {
      const historyIndex = isLateralEntry ? semNum - 3 : semNum - 1;
      const entry = examHistory[historyIndex];
      const sgpa = entry?.sgpa && entry.sgpa !== "N/A" ? entry.sgpa : "";
      const credits = entry ? parseInt(entry.credits_earned, 10) || null : null;
      map[semNum] = { sgpa, credits };
    }
    return map;
  }, [examHistory, isLateralEntry]);

  const semesterNumbers = useMemo(
    () => Object.keys(semesterDefaults).map(Number).sort((a, b) => a - b),
    [semesterDefaults],
  );

  // User edits always win over the default; an explicit empty string (a cleared box) also
  // wins over the default via `??`, since it's only nullish (undefined) values that fall through.
  const effectiveSgpaBySem = useMemo(() => {
    const merged: Record<number, string> = {};
    for (const semNum of semesterNumbers) {
      merged[semNum] = sgpaOverrides[semNum] ?? semesterDefaults[semNum]?.sgpa ?? "";
    }
    return merged;
  }, [semesterNumbers, semesterDefaults, sgpaOverrides]);

  const { cgpa: calculatedCgpa, enteredCount, fallbackCredits } = useMemo(() => {
    const entries: CgpaSemesterEntry[] = semesterNumbers.map((semNum) => {
      const raw = effectiveSgpaBySem[semNum]?.trim() ?? "";
      const parsed = raw === "" ? null : parseFloat(raw);
      return {
        sgpa: parsed !== null && !Number.isNaN(parsed) ? parsed : null,
        credits: semesterDefaults[semNum]?.credits ?? null,
      };
    });
    return computeCreditWeightedCgpa(entries);
  }, [semesterNumbers, effectiveSgpaBySem, semesterDefaults]);

  const handleSgpaChange = (semNum: number, value: string) => {
    if (value !== "") {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0 || num > 10) return;
    }
    setSgpaOverrides((prev) => ({ ...prev, [semNum]: value }));
  };

  // GRADE_COLORS["F"] is a near-black slate (#1e293b), tuned for a bar-chart fill elsewhere
  // in the dashboard — as on-dark text/border color here it's essentially invisible, so
  // substitute a legible neutral token rather than leaving "F" unreadable.
  const getReadableGradeColor = (grade: string): string =>
    grade === "F" ? "var(--text-secondary)" : GRADE_COLORS[grade];

  const creditOptions = useMemo(
    () => [0, 1, 2, 3, 4, 5].map((c) => ({ value: String(c), label: String(c) })),
    [],
  );

  const gradeOptions = useMemo(
    () =>
      Object.keys(GRADE_POINTS).map((g) => ({
        value: g,
        label: g,
        color: g === "F" ? "var(--text-secondary)" : GRADE_COLORS[g],
      })),
    [GRADE_POINTS, GRADE_COLORS],
  );

  return (
    <div className="tab-content">
      <DashboardHeader
        sectionTitle="Interactive Simulator"
        sectionSubtitle="Experiment with your grades and projected CGPA"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div className="chart-card predictor-card">
          <div className="chart-header">
            <h3 className="chart-title">
              <Sparkles size={18} style={{ display: "inline", color: "var(--success)", marginRight: "6px", verticalAlign: "-3px" }} />{" "}
              SGPA Calculator
            </h3>
            <p className="chart-subtitle">Simulate this semester&apos;s grades and credits to project your SGPA &amp; CGPA</p>
          </div>

          <div className="grade-scale">
            <span className="grade-scale-label">Grade Scale</span>
            <div className="grade-scale-items">
              {Object.entries(GRADE_POINTS).map(([g, pts]) => (
                <span key={g} className="grade-scale-pill" style={{ color: getReadableGradeColor(g) }}>
                  {g}
                  <span className="grade-scale-pts">{pts}</span>
                </span>
              ))}
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
                      <CustomSelect
                        className="credit-select"
                        value={String(simulatedCredits[subj.code] ?? 4)}
                        options={creditOptions}
                        onChange={(v) => setSimulatedCredits({ ...simulatedCredits, [subj.code]: parseInt(v, 10) })}
                        ariaLabel={`Credits for ${subj.name}`}
                      />
                      <CustomSelect
                        className="grade-select"
                        value={currentGrade}
                        options={gradeOptions}
                        color={getReadableGradeColor(currentGrade)}
                        onChange={(v) => setPredictedGrades({ ...predictedGrades, [subj.code]: v })}
                        ariaLabel={`Grade for ${subj.name}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="sgpa-summary">
            <div className="score-item sgpa">
              <div className="score-label">Projected SGPA</div>
              <div className="score-value">{projSGPA.toFixed(2)}</div>
            </div>
            <div className="sgpa-summary-divider" />
            <div className="score-item cgpa">
              <div className="score-label">Projected CGPA</div>
              <div className="score-value">{projCGPA.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="chart-card cgpa-calculator-card">
          <div className="chart-header">
            <h3 className="chart-title">
              <Calculator size={18} style={{ display: "inline", color: "var(--success)", marginRight: "6px", verticalAlign: "-3px" }} /> CGPA
              Calculator
            </h3>
            <p className="chart-subtitle">Enter your SGPA for any completed semester — CGPA updates live</p>
          </div>

          <div className="cgpa-grid">
            {semesterNumbers.map((semNum) => {
              const credits = semesterDefaults[semNum]?.credits ?? null;
              return (
                <div key={semNum} className="cgpa-slot">
                  <span className="cgpa-slot-label">Semester {semNum}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10}
                    step={0.01}
                    placeholder="—"
                    value={effectiveSgpaBySem[semNum] ?? ""}
                    onChange={(e) => handleSgpaChange(semNum, e.target.value)}
                    className="input-field cgpa-sgpa-input"
                    aria-label={`SGPA for Semester ${semNum}`}
                  />
                  <span className="cgpa-slot-credits">
                    {credits
                      ? `${credits} credits`
                      : fallbackCredits
                        ? `~${Math.round(fallbackCredits)} credits (estimated)`
                        : "Equal weight"}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="predictor-scoreboard cgpa-result">
            <div className="score-item cgpa">
              <div className="score-label">Calculated CGPA</div>
              <div className="score-value">{calculatedCgpa !== null ? calculatedCgpa.toFixed(2) : "—"}</div>
            </div>
          </div>

          {enteredCount > 0 && (
            <p className="cgpa-summary-note">
              Based on {enteredCount} semester{enteredCount !== 1 ? "s" : ""} entered.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
