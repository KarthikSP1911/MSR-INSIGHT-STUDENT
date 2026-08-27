"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell, ComposedChart, Line } from "recharts";
import { TrendingUp, Calendar, Star, AlertTriangle } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import type { StudentDetails, Subject } from "@/lib/studentDetails";

interface AnalyticsSectionProps {
  studentName: string;
  internalComparisonData: { code: string; name: string; studentScore: number; classAverage: number }[];
  gradeChartData: { grade: string; count: number; color: string }[];
  bestSubject: Subject | undefined;
  weakestSubject: Subject | undefined;
  overallAttendance: number;
  detailsBlob: StudentDetails;
  latestSGPA: number;
  sgpaDiffValue: number;
  sgpaTrendData: { name: string; sgpa: number; credits: number }[];
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string;
  payload?: { name: string; value: number; color?: string; fill?: string; payload: { name?: string; code?: string } }[];
}

const AnalyticsTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-chart-tooltip" style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}>
        <p className="tooltip-title">{data.name || label}</p>
        <div className="tooltip-divider"></div>

        {data.code && (
          <div className="tooltip-row">
            <span className="tooltip-label">Code</span>
            <span className="tooltip-value">{data.code}</span>
          </div>
        )}

        {payload.map((item, index) => (
          <div key={index} className="tooltip-row">
            <span className="tooltip-label">{item.name}</span>
            <span className="tooltip-value" style={{ color: item.color || item.fill }}>
              {item.value} {item.name.toLowerCase().includes("score") || item.name.toLowerCase().includes("average") ? "/ 50" : ""}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function AnalyticsSection({
  studentName,
  internalComparisonData,
  gradeChartData,
  bestSubject,
  weakestSubject,
  overallAttendance,
  latestSGPA,
  sgpaDiffValue,
  sgpaTrendData,
}: AnalyticsSectionProps) {
  return (
    <div className="tab-content">
      <DashboardHeader name={studentName} sectionTitle="Academic Analytics" sectionSubtitle="Deep insights into your academic journey" />

      <div className="charts-grid">
        <div className="chart-card wide-chart">
          <div className="chart-header">
            <div>
              <h3 className="chart-title">Class Benchmark: CIE Scores</h3>
              <p className="chart-subtitle">Combined score (Avg of T1 &amp; T2 + Assessments) compared to class average</p>
            </div>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={internalComparisonData} margin={{ top: 20, right: 10, bottom: 40, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.25)" />
                <XAxis dataKey="code" stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 50]} stroke="#64748b" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Legend verticalAlign="top" height={40} iconType="circle" />
                <Bar dataKey="studentScore" name="Your Score" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} barSize={24} />
                <Bar dataKey="classAverage" name="Class Average" fill="var(--accent-primary)" opacity={0.5} radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h3 className="chart-title">Grade Distribution</h3>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={gradeChartData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.25)" vertical={false} />
                <XAxis dataKey="grade" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "12px",
                    color: "#ffffff",
                  }}
                  labelStyle={{ color: "#ffffff" }}
                  itemStyle={{ color: "#ffffff" }}
                  cursor={{ fill: "var(--bg-primary)", opacity: 0.4 }}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {gradeChartData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h3 className="chart-title">SGPA &amp; Credits Trajectory</h3>
          </div>
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={sgpaTrendData} margin={{ top: 20, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.25)" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} width={40} />
                <YAxis yAxisId="right" orientation="right" hide />
                <Tooltip content={<AnalyticsTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Bar yAxisId="left" dataKey="credits" fill="rgba(16, 185, 129, 0.3)" radius={[4, 4, 0, 0]} name="Credits" />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="sgpa"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#3b82f6" }}
                  activeDot={{ r: 6 }}
                  name="SGPA"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="chart-card wide-chart performance-insights-card" style={{ marginTop: "24px" }}>
        <div className="chart-header">
          <h3 className="chart-title">Performance Insights</h3>
        </div>
        <div className="insights-grid">
          <div className="insight-item">
            <TrendingUp className="insight-icon success" />
            <div>
              <div className="insight-label">Academic Standing</div>
              <div className="insight-value">
                Your current SGPA is {latestSGPA}.
                {sgpaDiffValue !== 0
                  ? (sgpaDiffValue >= 0
                      ? ` Improved by ${sgpaDiffValue.toFixed(2)}`
                      : ` Decreased by ${Math.abs(sgpaDiffValue).toFixed(2)}`) + " compared to the previous semester."
                  : ""}
              </div>
            </div>
          </div>
          <div className="insight-item">
            <Calendar className="insight-icon" style={{ color: overallAttendance >= 75 ? "var(--success)" : "var(--error)" }} />
            <div>
              <div className="insight-label">Attendance Analysis</div>
              <div className="insight-value">
                {overallAttendance >= 85
                  ? "Excellent attendance record!"
                  : overallAttendance >= 75
                    ? "Attendance is adequate."
                    : "Attendance needs immediate improvement."}
              </div>
            </div>
          </div>
          {bestSubject && (
            <div className="insight-item">
              <Star className="insight-icon" style={{ color: "#F59E0B" }} />
              <div>
                <div className="insight-label">Top Performing Subject</div>
                <div className="insight-value">
                  {bestSubject.name} ({bestSubject.code}) — {bestSubject.marks}/50 CIE Marks
                </div>
              </div>
            </div>
          )}
          {weakestSubject && weakestSubject.code !== bestSubject?.code && (
            <div className="insight-item">
              <AlertTriangle className="insight-icon" style={{ color: "#EF4444" }} />
              <div>
                <div className="insight-label">Requires Attention</div>
                <div className="insight-value">
                  {weakestSubject.name} ({weakestSubject.code}) — {weakestSubject.marks}/50 CIE Marks
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
