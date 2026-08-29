"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Target, History as HistoryIcon, Gamepad2, LogOut, BookOpen } from "lucide-react";
// import { BarChart3 } from "lucide-react"; // Analytics tab temporarily disabled
import "@/styles/StudentDashboard.css";
import SubjectDetail from "@/app/(dashboard)/student/dashboard/components/SubjectDetail";
import SidebarProfile from "@/components/dashboard/SidebarProfile";
import Image from "next/image";
import Link from "next/link";

import { useCooldown } from "@/hooks/useCooldown";
import { useScrapeJobPolling } from "@/hooks/useScrapeJobPolling";

import PerformanceSection from "@/components/dashboard/sections/PerformanceSection";
// import AnalyticsSection from "@/components/dashboard/sections/AnalyticsSection"; // Analytics tab temporarily disabled
import HistorySection from "@/components/dashboard/sections/HistorySection";
import SimulatorSection from "@/components/dashboard/sections/SimulatorSection";
import NotesSection from "@/components/dashboard/sections/NotesSection";
import LoadingScreen from "@/components/dashboard/LoadingScreen";
import BirthdayBanner from "@/components/dashboard/BirthdayBanner";

import type { Student } from "@/lib/db/schema";
import { hasScrapedData, type Subject } from "@/lib/studentDetails";

const GRADE_COLORS: Record<string, string> = {
  O: "#8b5cf6",
  "A+": "#3b82f6",
  A: "#10b981",
  "B+": "#f59e0b",
  B: "var(--accent-primary)",
  C: "#ef4444",
  P: "#64748b",
  F: "#1e293b",
};

const GRADE_POINTS: Record<string, number> = {
  O: 10,
  "A+": 9,
  A: 8,
  "B+": 7,
  B: 6,
  C: 5,
  P: 4,
  F: 0,
};

const PROFILE_QUERY_KEY = ["studentProfile"];

export default function StudentDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeTab = searchParams.get("tab") || "performance";

  const [nextAllowedAt, setNextAllowedAt] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [predictedGrades, setPredictedGrades] = useState<Record<string, string>>({});
  const [simulatedCredits, setSimulatedCredits] = useState<Record<string, number>>({});
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number>(0);
  const [updateStatus, setUpdateStatus] = useState<"loading" | "success" | "error" | null>(() =>
    searchParams.get("syncJobId") ? "loading" : null,
  );
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showMobileProfileMenu, setShowMobileProfileMenu] = useState(false);
  // Captured once, lazily, from the ?syncJobId= param a fresh login redirect may carry —
  // reading it in a state initializer (rather than an effect) avoids a spurious setState-in-effect.
  const [syncJobId, setSyncJobId] = useState<string | null>(() => searchParams.get("syncJobId"));

  const { status: jobStatus, progress: jobProgress, error: jobError } = useScrapeJobPolling(syncJobId);

  // Drop ?syncJobId= from the URL once captured, so a refresh doesn't re-trigger it.
  // (router.replace isn't a setState call, so this doesn't trip set-state-in-effect.)
  useEffect(() => {
    if (!searchParams.get("syncJobId")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("syncJobId");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".mobile-nav-profile")) {
        setShowMobileProfileMenu(false);
      }
    };
    if (showMobileProfileMenu) {
      document.addEventListener("click", handleOutsideClick);
    }
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [showMobileProfileMenu]);

  const {
    data: student,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery<Student>({
    queryKey: PROFILE_QUERY_KEY,
    retry: false,
    queryFn: async () => {
      const response = await fetch("/api/auth/profile");
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw { redirectTo: "/student-login", status: response.status };
      }
      return body.data as Student;
    },
  });
  const loading = profileLoading;

  useEffect(() => {
    if (!profileError) return;
    const err = profileError as { redirectTo?: string };
    if (err?.redirectTo) {
      router.push(err.redirectTo);
    }
  }, [profileError, router]);

  // Once a scrape job finishes, refresh the profile so newly-scraped data appears.
  // TanStack Query v5 has no built-in onSuccess/onError for useQuery, so reacting
  // to a resolved query's data via effect is the documented pattern here.
  useEffect(() => {
    if (jobStatus === "success") {
      queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUpdateStatus("success");
      setSyncJobId(null);
      setTimeout(() => setUpdateStatus(null), 3000);
    } else if (jobStatus === "failed") {
      setSyncJobId(null);

      // A failed sync with no scraped data yet means this was the first-ever
      // login attempt and the USN/DOB/PIN never actually got past the portal's
      // own login form — the worker also drops the unverified student row in
      // this case (see scraper-worker.ts), so bounce back to the login form
      // with the error surfaced, rather than stranding the student on a
      // permanently-empty dashboard.
      if (!hasScrapedData(student?.details)) {
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
          router.push(`/student-login?error=${encodeURIComponent(jobError || "We couldn't verify your details. Please try again.")}`);
        });
      } else {
        setUpdateStatus("error");
        setUpdateError(jobError);
        setTimeout(() => setUpdateStatus(null), 4000);
      }
    }
  }, [jobStatus, jobError, queryClient, student, router]);

  const detailsBlob = useMemo(() => student?.details || {}, [student]);
  const currentSem = useMemo(() => detailsBlob.subjects || detailsBlob.current_semester || [], [detailsBlob]);
  const examHistory = useMemo(() => detailsBlob.exam_history || [], [detailsBlob]);

  const currentCgpa = useMemo(() => {
    const val = (detailsBlob.cgpa ?? "").toString().trim();
    return val || null;
  }, [detailsBlob]);

  const totalCredits = useMemo(
    () => examHistory.reduce((acc, sem) => acc + (parseInt(sem.credits_earned) || 0), 0),
    [examHistory],
  );

  const latestSGPA = useMemo(
    () => (examHistory.length > 0 ? parseFloat(examHistory[examHistory.length - 1].sgpa) || 0 : 0),
    [examHistory],
  );

  const prevSGPA = useMemo(
    () => (examHistory.length > 1 ? parseFloat(examHistory[examHistory.length - 2].sgpa) || 0 : 0),
    [examHistory],
  );

  // Analytics tab temporarily disabled — sgpaDiffValue was only consumed there.
  // const sgpaDiffValue = useMemo(() => latestSGPA - prevSGPA, [latestSGPA, prevSGPA]);

  const stdUsn = useMemo(() => student?.usn || detailsBlob.usn || "", [student, detailsBlob]);

  const isLateralEntry = useMemo(() => /4\d{2}$/.test(stdUsn), [stdUsn]);
  const maxCredits = isLateralEntry ? 120 : 160;

  const overallAttendance = useMemo(
    () =>
      currentSem.length
        ? Math.round(currentSem.reduce((acc, curr) => acc + (curr.attendance || 0), 0) / currentSem.length)
        : 0,
    [currentSem],
  );

  // Analytics tab temporarily disabled — sgpaTrendData, gradeChartData, internalComparisonData,
  // bestSubject, and weakestSubject were only consumed there.
  // const sgpaTrendData = useMemo(
  //   () =>
  //     examHistory.map((sem) => ({
  //       name: sem.semester.split(" ")[0] + " " + (sem.semester.split(" ")[2]?.substring(2) || ""),
  //       sgpa: parseFloat(sem.sgpa),
  //       credits: parseInt(sem.credits_earned || "0"),
  //     })),
  //   [examHistory],
  // );

  // const gradeChartData = useMemo(() => {
  //   const allGrades = examHistory.flatMap((sem) => sem.courses?.map((c) => c.grade) || []);
  //   const distribution = allGrades.reduce<Record<string, number>>((acc, grade) => {
  //     acc[grade] = (acc[grade] || 0) + 1;
  //     return acc;
  //   }, {});
  //   return Object.entries(distribution)
  //     .map(([grade, count]) => ({ grade, count, color: GRADE_COLORS[grade] || "#64748b" }))
  //     .sort((a, b) => b.count - a.count);
  // }, [examHistory]);

  // const internalComparisonData = useMemo(() => {
  //   return currentSem
  //     .map((subj) => {
  //       const getScores = (type: string) => {
  //         const a = subj.assessments?.find((x) => x.type === type);
  //         return { me: a?.obtained_marks || 0, avg: a?.class_average || 0 };
  //       };
  //       const t1 = getScores("T1");
  //       const t2 = getScores("T2");
  //       const aq1 = getScores("AQ1");
  //       const aq2 = getScores("AQ2");
  //       const testAvg = t1.me > 0 && t2.me > 0 ? Math.round((t1.me + t2.me) / 2) : Math.max(t1.me, t2.me);
  //       const avgTotal = t1.avg > 0 && t2.avg > 0 ? Math.round((t1.avg + t2.avg) / 2) : Math.max(t1.avg, t2.avg);
  //       return {
  //         code: subj.code,
  //         name: subj.name,
  //         studentScore: testAvg + aq1.me + aq2.me,
  //         classAverage: avgTotal + aq1.avg + aq2.avg,
  //       };
  //     })
  //     .filter((d) => d.studentScore > 0 || d.classAverage > 0);
  // }, [currentSem]);

  // const bestSubject = useMemo(() => {
  //   return [...currentSem]
  //     .filter((s) => s.marks > 0 || (s.attendance && s.attendance > 0))
  //     .sort((a, b) => (b.marks * 2 + b.attendance) - (a.marks * 2 + a.attendance))[0];
  // }, [currentSem]);

  // const weakestSubject = useMemo(() => {
  //   return [...currentSem]
  //     .filter((s) => s.marks > 0 || (s.attendance && s.attendance > 0))
  //     .sort((a, b) => (a.marks * 2 + a.attendance) - (b.marks * 2 + b.attendance))[0];
  // }, [currentSem]);

  const isBirthday = useMemo(() => {
    if (!student?.dob) return false;
    try {
      const [day, month] = student.dob.split("-");
      const today = new Date();
      return today.getDate() === parseInt(day, 10) && today.getMonth() + 1 === parseInt(month, 10);
    } catch {
      return false;
    }
  }, [student]);

  // Cooldown target derived from the last sync time; setNextAllowedAt (below, in
  // handleUpdate) only ever overrides this with a fresher value from a 429 response.
  const derivedNextAllowedAt = useMemo(() => {
    const lastSync = detailsBlob.last_updated;
    if (!lastSync) return null;
    return new Date(new Date(lastSync).getTime() + 5 * 60 * 1000).toISOString();
  }, [detailsBlob]);

  const { formatTime, isCooldownActive } = useCooldown(nextAllowedAt ?? derivedNextAllowedAt);

  // Simulator defaults (grade "O", 4 credits per subject), merged with any values the
  // user has already picked — computed at render instead of initialized via effect so
  // it never needs to distinguish "not yet initialized" from "user cleared it".
  const effectivePredictedGrades = useMemo(() => {
    const defaults: Record<string, string> = {};
    currentSem.forEach((s) => {
      defaults[s.code] = "O";
    });
    return { ...defaults, ...predictedGrades };
  }, [currentSem, predictedGrades]);

  const effectiveSimulatedCredits = useMemo(() => {
    const defaults: Record<string, number> = {};
    currentSem.forEach((s) => {
      defaults[s.code] = 4;
    });
    return { ...defaults, ...simulatedCredits };
  }, [currentSem, simulatedCredits]);

  const handleTabChange = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
    setSelectedSubject(null);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("[dashboard] logout request failed:", err);
    }
    router.push("/");
  };

  const handleUpdate = async () => {
    if (isCooldownActive || updateStatus === "loading") return;
    setUpdateStatus("loading");
    setUpdateError(null);
    try {
      const response = await fetch("/api/report/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usn: stdUsn }),
      });
      const body = await response.json();

      if (response.status === 429) {
        setUpdateStatus(null);
        if (body.nextAllowedAt) setNextAllowedAt(body.nextAllowedAt);
        return;
      }
      if (response.status === 401 && body.requiresRelogin) {
        // No saved portal PIN to sync with — send them to the login page's own secondary-auth
        // flow (same UI as first-time login) rather than asking for it again here.
        setUpdateStatus(null);
        router.push("/student-login?relogin=1");
        return;
      }
      if (!response.ok || !body.success) {
        setUpdateStatus("error");
        setUpdateError(body.message || "Update failed");
        setTimeout(() => setUpdateStatus(null), 3000);
        return;
      }

      setSyncJobId(body.data.jobId);
    } catch (err) {
      console.error("[dashboard] manual update request failed:", err);
      setUpdateStatus("error");
      setUpdateError("Update failed");
      setTimeout(() => setUpdateStatus(null), 3000);
    }
  };

  if (loading || !student) return <LoadingScreen />;

  // First-time login: the profile row exists (created up front so the login form can hand
  // off a session) but nothing's been scraped yet — show a dedicated syncing screen instead
  // of the full dashboard chrome around empty sections. The jobStatus effect above already
  // bounces back to /student-login with an error once this either succeeds or gives up
  // (worker timeout, MAX_POLL_MS client backstop, or a lost mobile connection), so this can't
  // strand the student here indefinitely.
  if (updateStatus === "loading" && !hasScrapedData(student.details)) {
    return <LoadingScreen message={jobProgress || "Verifying your details and syncing your portal data — this can take up to a minute."} />;
  }

  return (
    <div className="student-dashboard-container">
      <aside className="dashboard-sidebar">
        <div className="sidebar-branding">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo-icon.svg" alt="logo" width={32} height={32} priority />
            <span className="sidebar-app-name">MSR Insight</span>
          </Link>
        </div>

        <nav className="sidebar-navigation">
          {[
            { id: "performance", icon: <Target size={20} />, label: "Current Semester" },
            { id: "notes", icon: <BookOpen size={20} />, label: "Notes & PYQs" },
            // Analytics tab temporarily disabled — see activeTab === "analytics" render block below.
            // { id: "analytics", icon: <BarChart3 size={20} />, label: "Analytics" },
            { id: "history", icon: <HistoryIcon size={20} />, label: "Exam History" },
            { id: "simulator", icon: <Gamepad2 size={20} />, label: "Simulator" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`nav-button ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.icon} <span>{tab.label}</span>
            </button>
          ))}
        </nav>
        <SidebarProfile user={student} onLogout={handleLogout} />
      </aside>

      <header className="mobile-top-navbar">
        <div className="mobile-nav-brand">
          <Image src="/logo-icon.svg" alt="logo" width={28} height={28} priority />
          <span className="mobile-app-name">MSR Insight</span>
        </div>
        <div className="mobile-nav-profile" style={{ position: "relative" }}>
          <div
            className="profile-initials-avatar"
            style={{ width: 32, height: 32, fontSize: 12, cursor: "pointer" }}
            onClick={() => setShowMobileProfileMenu(!showMobileProfileMenu)}
          >
            {student?.name?.charAt(0) || "S"}
          </div>
          {showMobileProfileMenu && (
            <div
              className="mobile-profile-dropdown"
              style={{
                position: "absolute",
                right: 0,
                top: "42px",
                background: "var(--bg-card, #1B2333)",
                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                borderRadius: "12px",
                padding: "12px",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                minWidth: "180px",
                zIndex: 1001,
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)", paddingBottom: "8px" }}>
                <div style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-primary)" }}>{student?.name}</div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{student?.usn}</div>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "8px 10px",
                  background: "rgba(239, 68, 68, 0.1)",
                  color: "#EF4444",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <LogOut size={16} /> Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="dashboard-main-content">
        <div className="content-wrapper">
          {isBirthday && <BirthdayBanner studentName={student?.name || "Student"} />}
          {updateError && updateStatus === "error" && (
            <div className="update-error-banner" role="alert">
              {updateError}
            </div>
          )}
          {selectedSubject ? (
            <SubjectDetail
              subject={selectedSubject}
              allSubjects={currentSem}
              onSubjectChange={setSelectedSubject}
              onBack={() => setSelectedSubject(null)}
            />
          ) : (
            <>
              {activeTab === "performance" && (
                <PerformanceSection
                  currentSem={currentSem}
                  overallAttendance={overallAttendance}
                  totalCredits={totalCredits}
                  maxCredits={maxCredits}
                  currentCgpa={currentCgpa}
                  onSelectSubject={setSelectedSubject}
                  handleUpdate={handleUpdate}
                  updateStatus={updateStatus}
                  isCooldownActive={isCooldownActive}
                  formatTime={formatTime}
                  examHistory={examHistory}
                  latestSGPA={latestSGPA}
                  isImproved={latestSGPA >= prevSGPA}
                  sgpaDiff={(latestSGPA - prevSGPA >= 0 ? "+" : "") + (latestSGPA - prevSGPA).toFixed(2)}
                />
              )}
              {/* Analytics tab temporarily disabled — see nav lists above.
              {activeTab === "analytics" && (
                <AnalyticsSection
                  internalComparisonData={internalComparisonData}
                  gradeChartData={gradeChartData}
                  bestSubject={bestSubject}
                  weakestSubject={weakestSubject}
                  overallAttendance={overallAttendance}
                  detailsBlob={detailsBlob}
                  latestSGPA={latestSGPA}
                  sgpaDiffValue={sgpaDiffValue}
                  sgpaTrendData={sgpaTrendData}
                />
              )}
              */}
              {activeTab === "history" && (
                <HistorySection
                  examHistory={examHistory}
                  selectedHistoryIdx={selectedHistoryIdx}
                  setSelectedHistoryIdx={setSelectedHistoryIdx}
                  GRADE_COLORS={GRADE_COLORS}
                  isLateralEntry={isLateralEntry}
                />
              )}
              {activeTab === "notes" && (
                <NotesSection
                  usn={stdUsn}
                  currentSemSubjects={currentSem}
                  examHistory={examHistory}
                />
              )}
              {activeTab === "simulator" && (
                <SimulatorSection
                  currentSem={currentSem}
                  predictedGrades={effectivePredictedGrades}
                  simulatedCredits={effectiveSimulatedCredits}
                  setPredictedGrades={setPredictedGrades}
                  setSimulatedCredits={setSimulatedCredits}
                  currentCgpa={currentCgpa}
                  totalCredits={totalCredits}
                  GRADE_COLORS={GRADE_COLORS}
                  GRADE_POINTS={GRADE_POINTS}
                  examHistory={examHistory}
                  isLateralEntry={isLateralEntry}
                />
              )}
            </>
          )}
        </div>
      </main>

      <nav className="mobile-bottom-nav">
        {[
          { id: "performance", icon: <Target size={20} />, label: "Semester" },
          { id: "notes", icon: <BookOpen size={20} />, label: "Notes" },
          // Analytics tab temporarily disabled — see activeTab === "analytics" render block above.
          // { id: "analytics", icon: <BarChart3 size={20} />, label: "Analytics" },
          { id: "history", icon: <HistoryIcon size={20} />, label: "History" },
          { id: "simulator", icon: <Gamepad2 size={20} />, label: "Sim" },
        ].map((tab) => (
          <button
            key={tab.id}
            className={`bottom-nav-item ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
