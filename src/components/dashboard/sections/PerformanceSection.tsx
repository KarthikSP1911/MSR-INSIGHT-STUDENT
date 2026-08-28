"use client";

import type { ReactNode } from "react";
import { Award, BookOpen, Layers, TrendingUp } from "lucide-react";
import {
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { UpdateButton } from "@/components/dashboard/UpdateButton";
import type { ExamHistoryEntry, Subject } from "@/lib/studentDetails";

interface PerformanceSectionProps {
  currentSem: Subject[];
  overallAttendance: number;
  totalCredits: number;
  maxCredits: number;
  currentCgpa: string | null;
  onSelectSubject: (subject: Subject) => void;
  handleUpdate: () => void;
  updateStatus: "loading" | "success" | "error" | null;
  isCooldownActive: boolean;
  formatTime: string;
  examHistory: ExamHistoryEntry[];
  latestSGPA: number;
  sgpaDiff: string;
  isImproved: boolean;
}

/** Matches the same >=85/>=75/else thresholds used by the attendance pill in the table below. */
const getAttendanceBarColor = (attendance: number): string => {
  if (attendance >= 85) return "var(--success, #10B981)";
  if (attendance >= 75) return "var(--warning, #F59E0B)";
  return "var(--error, #EF4444)";
};

/** Matches the same >=30 threshold used by the CIE marks pill in the table below. */
const getCieBarColor = (marks: number): string => (marks >= 30 ? "var(--success, #10B981)" : "var(--warning, #F59E0B)");

/** Row height for the Attendance chart's single-line subject labels. */
const SUBJECT_ROW_HEIGHT = 44;
/** Taller row height for the CIE chart, whose Y-axis label wraps subject name and code onto two lines. */
const CIE_ROW_HEIGHT = 56;

/** Y-axis category width for the CIE chart's two-line "Name" / "CODE" labels, and the character
 * budget the name line fits inside — long names are truncated with an ellipsis rather than
 * overlapping/clipping; the full name and code are still available in the tooltip. */
const CIE_YAXIS_WIDTH = 240;
const CIE_YAXIS_MAX_CHARS = 30;
/** Joins name/code for the Y-axis dataKey; "|" never appears in a real subject name or code. */
const CIE_LABEL_SEPARATOR = "|";

interface YAxisTickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
}

const CieYAxisTick = ({ x, y, payload }: YAxisTickProps) => {
  const [name = "", code = ""] = (payload?.value ?? "").split(CIE_LABEL_SEPARATOR);
  const nameLine = name.length > CIE_YAXIS_MAX_CHARS ? `${name.slice(0, CIE_YAXIS_MAX_CHARS - 1)}…` : name;
  return (
    <text x={x} textAnchor="end">
      <tspan x={x} y={y} dy={-3} fontSize={12} fill="var(--text-primary)">
        {nameLine}
      </tspan>
      <tspan x={x} y={y} dy={12} fontSize={10} fill="var(--text-muted)">
        {code}
      </tspan>
    </text>
  );
};

interface ChartTooltipProps {
  active?: boolean;
  payload?: { payload: Subject & { fill?: string } }[];
}

const AttendanceTooltip = ({ active, payload }: ChartTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-chart-tooltip" style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}>
        <p className="tooltip-title">{data.name}</p>
        <div className="tooltip-divider"></div>
        <div className="tooltip-row">
          <span className="tooltip-label">Code</span>
          <span className="tooltip-value">{data.code}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Attendance</span>
          <span className="tooltip-value" style={{ color: data.fill || "var(--accent-primary)" }}>
            {data.attendance}%
          </span>
        </div>
      </div>
    );
  }
  return null;
};

const MarksTooltip = ({ active, payload }: ChartTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-chart-tooltip" style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}>
        <p className="tooltip-title">{data.name}</p>
        <div className="tooltip-divider"></div>
        <div className="tooltip-row">
          <span className="tooltip-label">Code</span>
          <span className="tooltip-value">{data.code}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">CIE Score</span>
          <span className="tooltip-value" style={{ color: data.fill || "var(--accent-primary)" }}>
            {data.marks} / 50
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function PerformanceSection({
  currentSem,
  totalCredits,
  maxCredits,
  currentCgpa,
  onSelectSubject,
  handleUpdate,
  updateStatus,
  isCooldownActive,
  formatTime,
  examHistory,
  latestSGPA,
  sgpaDiff,
  isImproved,
}: PerformanceSectionProps) {
  return (
    <div className="tab-content">
      <DashboardHeader
        sectionTitle="Current Semester Performance"
        sectionSubtitle="A detailed breakdown of your ongoing academic progress"
        actions={
          <UpdateButton
            onClick={handleUpdate}
            isLoading={updateStatus === "loading"}
            cooldownActive={isCooldownActive}
            formattedCooldown={formatTime}
          />
        }
      />

      <div className="stats-grid">
        <div className="stat-card anim-left">
          <div className="stat-header">
            <span className="stat-label">Current CGPA</span>
            <Award size={18} />
          </div>
          <div className="stat-value">
            {currentCgpa ?? "—"}
            {currentCgpa && <span className="stat-max">/10</span>}
          </div>
          <p className="stat-footnote">Overall cumulative GPA</p>
        </div>
        <div className="stat-card anim-left">
          <div className="stat-header">
            <span className="stat-label">Total Credits</span>
            <BookOpen size={18} />
          </div>
          <div className="stat-value">
            {totalCredits}
            <span className="stat-max">/{maxCredits}</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(totalCredits / maxCredits) * 100}%`, backgroundColor: "var(--accent-primary)" }}
            ></div>
          </div>
        </div>
        <div className="stat-card anim-right">
          <div className="stat-header">
            <span className="stat-label">Active Courses</span>
            <Layers size={18} />
          </div>
          <div className="stat-value">{currentSem.length}</div>
          <p className="stat-footnote">This semester load</p>
        </div>
        <div className="stat-card anim-right">
          <div className="stat-header">
            <span className="stat-label">Latest semester SGPA</span>
            <TrendingUp className="stat-icon" />
          </div>
          <div className="stat-value">{examHistory.length > 0 ? latestSGPA : "—"}</div>
          {examHistory.length > 1 ? (
            <div className={`trend-badge ${isImproved ? "positive" : "negative"}`}>
              {isImproved ? <TrendingUp size={14} /> : <TrendingUp size={14} style={{ transform: "rotate(180deg)" }} />}
              {sgpaDiff} vs previous
            </div>
          ) : (
            <p className="stat-footnote">
              {examHistory.length === 1 ? "Compares once more history is available" : "No semester results in history yet"}
            </p>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        <div className="chart-card">
          <div className="chart-header">
            <h3 className="chart-title">Attendance Overview</h3>
            <p className="chart-subtitle">Subject-wise attendance for this semester</p>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={Math.max(280, currentSem.length * SUBJECT_ROW_HEIGHT + 60)}>
              <BarChart
                layout="vertical"
                data={currentSem.map((s) => ({ ...s, fill: getAttendanceBarColor(s.attendance || 0) }))}
                margin={{ top: 28, right: 56, left: 10, bottom: 10 }}
                barSize={22}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v) => `${v}%`}
                  stroke="var(--text-muted)"
                  style={{ fontSize: "11px" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={180}
                  interval={0}
                  stroke="var(--text-muted)"
                  style={{ fontSize: "12px" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<AttendanceTooltip />} cursor={{ fill: "var(--bg-primary)" }} />
                <ReferenceLine
                  x={50}
                  stroke="var(--text-muted)"
                  strokeDasharray="4 4"
                  label={{ value: "50%", position: "top", fill: "var(--text-muted)", fontSize: 11 }}
                />
                <ReferenceLine
                  x={75}
                  stroke="var(--warning, #F59E0B)"
                  strokeWidth={2}
                  label={{ value: "75%", position: "top", fill: "var(--warning, #F59E0B)", fontSize: 12, fontWeight: 700 }}
                />
                <ReferenceLine
                  x={85}
                  stroke="var(--text-muted)"
                  strokeDasharray="4 4"
                  label={{ value: "85%", position: "top", fill: "var(--text-muted)", fontSize: 11 }}
                />
                <Bar
                  dataKey="attendance"
                  radius={[0, 4, 4, 0]}
                  onClick={(data) => data && onSelectSubject((data as unknown as { payload: Subject }).payload)}
                  style={{ cursor: "pointer" }}
                >
                  {currentSem.map((s, i) => (
                    <Cell key={i} fill={getAttendanceBarColor(s.attendance || 0)} />
                  ))}
                  <LabelList
                    dataKey="attendance"
                    position="right"
                    formatter={(value: ReactNode) => `${Math.round(Number(value) || 0)}%`}
                    style={{ fill: "var(--text-primary)", fontSize: "12px", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Internal Marks (CIE)</h3>
              <p className="chart-subtitle">Subject-wise CIE scores out of 50</p>
            </div>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={Math.max(280, currentSem.length * CIE_ROW_HEIGHT + 60)}>
              <BarChart
                layout="vertical"
                data={currentSem.map((s) => ({
                  ...s,
                  label: `${s.name}${CIE_LABEL_SEPARATOR}${s.code}`,
                  fill: getCieBarColor(s.marks || 0),
                }))}
                margin={{ top: 28, right: 56, left: 10, bottom: 10 }}
                barSize={22}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 50]}
                  ticks={[0, 10, 20, 30, 40, 50]}
                  stroke="var(--text-muted)"
                  style={{ fontSize: "11px" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={CIE_YAXIS_WIDTH}
                  interval={0}
                  tick={<CieYAxisTick />}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<MarksTooltip />} cursor={{ fill: "var(--bg-primary)" }} />
                <ReferenceLine
                  x={30}
                  stroke="var(--warning, #F59E0B)"
                  strokeWidth={2}
                  label={{ value: "30", position: "top", fill: "var(--warning, #F59E0B)", fontSize: 12, fontWeight: 700 }}
                />
                <Bar
                  dataKey="marks"
                  radius={[0, 4, 4, 0]}
                  onClick={(data) => data && onSelectSubject((data as unknown as { payload: Subject }).payload)}
                  style={{ cursor: "pointer" }}
                >
                  {currentSem.map((s, i) => (
                    <Cell key={i} fill={getCieBarColor(s.marks || 0)} />
                  ))}
                  <LabelList
                    dataKey="marks"
                    position="right"
                    formatter={(value: ReactNode) => `${Math.round(Number(value) || 0)}`}
                    style={{ fill: "var(--text-primary)", fontSize: "12px", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="table-section-wrapper" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 4px" }}>
            <span className="mobile-tap-hint" style={{ fontSize: "12px", color: "var(--accent-primary)", opacity: 0.9, fontWeight: 500 }}>
              Tap any Subject for details
            </span>
          </div>
          <div className="dashboard-table-container">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th className="course-code-col">Code</th>
                  <th className="course-name-col">Course Name</th>
                  <th className="attendance-col" style={{ textAlign: "center" }}>
                    Attendance
                  </th>
                  <th className="cie-col" style={{ textAlign: "center" }}>
                    CIE Marks
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentSem.map((s, idx) => {
                  const att = Math.round(s.attendance || 0);
                  const attClass = att >= 85 ? "success" : att >= 75 ? "warning" : "error";
                  return (
                    <tr key={idx} onClick={() => onSelectSubject(s)} className="interactive-row">
                      <td className="text-muted course-code-col">{s.code}</td>
                      <td className="font-semibold course-name-col">{s.name}</td>
                      <td className="attendance-col" style={{ textAlign: "center" }}>
                        <span className={`pill ${attClass}`}>{att}%</span>
                      </td>
                      <td className="cie-col" style={{ textAlign: "center" }}>
                        <span className={`pill ${s.marks >= 30 ? "success" : "warning"}`}>{s.marks} / 50</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
