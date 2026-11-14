"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Target, History as HistoryIcon, Gamepad2, LogOut, BookOpen, Settings, ArrowLeft } from "lucide-react";
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
import SettingsSection from "@/components/dashboard/sections/SettingsSection";
import LoadingScreen from "@/components/dashboard/LoadingScreen";
import BirthdayBanner from "@/components/dashboard/BirthdayBanner";
import PortalUnavailableBanner from "@/components/dashboard/PortalUnavailableBanner";
import ProfileUnavailable from "@/components/dashboard/ProfileUnavailable";
import ServerUnavailableBanner from "@/components/dashboard/ServerUnavailableBanner";

import { clearCacheOnLogout, readCachedProfileForSession, writeCachedProfile } from "@/lib/cache/profileCache";
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

/** How often to retry the server while the dashboard is showing the copy saved on this device. */
const CACHED_PROFILE_RECHECK_MS = 60_000;

/** How often to retry while the "couldn't load your dashboard" screen is up, so it clears by itself. */
const PROFILE_ERROR_RECHECK_MS = 30_000;

/** The profile as the dashboard renders it: live from the server, or the copy saved on this device. */
interface ProfileResult {
  student: Student;
  fromCache: boolean;
  /** When the cached copy was saved; null for live data. */
  savedAt: string | null;
}

export default function StudentDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileImgError, setMobileImgError] = useState(false);

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeTab = searchParams.get("tab") || "performance";

  const [avatarSeedSuffix, setAvatarSeedSuffix] = useState("");
  useEffect(() => {
    const saved = localStorage.getItem("avatarSeedSuffix");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setAvatarSeedSuffix(saved);
  }, []);
  const handleAvatarChange = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newSuffix = Math.random().toString(36).substring(7);
    setAvatarSeedSuffix(newSuffix);
    localStorage.setItem("avatarSeedSuffix", newSuffix);
  };

  const [nextAllowedAt, setNextAllowedAt] = useState<string | null>(null);
  const [examNextAllowedAt, setExamNextAllowedAt] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [predictedGrades, setPredictedGrades] = useState<Record<string, string>>({});
  const [simulatedCredits, setSimulatedCredits] = useState<Record<string, number>>({});
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number>(0);
  const [updateStatus, setUpdateStatus] = useState<"loading" | "success" | "error" | null>(() =>
    searchParams.get("syncJobId") ? "loading" : null,
  );
  const [updateError, setUpdateError] = useState<string | null>(null);
  // The last sync failed because the college portal itself could not be used, not because of anything the student did.
  const [portalUnavailable, setPortalUnavailable] = useState(false);
  const [showMobileProfileMenu, setShowMobileProfileMenu] = useState(false);
  // Captured once, lazily, from the ?syncJobId= param a fresh login redirect may carry —
  // reading it in a state initializer (rather than an effect) avoids a spurious setState-in-effect.
  const [syncJobId, setSyncJobId] = useState<string | null>(() => searchParams.get("syncJobId"));

  const { status: jobStatus, progress: jobProgress, error: jobError, failureKind } = useScrapeJobPolling(syncJobId);

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
    data: profileResult,
    isLoading: profileLoading,
    error: profileError,
    isFetching: profileFetching,
    errorUpdateCount: profileFailureCount,
    refetch: refetchProfile,
  } = useQuery<ProfileResult>({
    queryKey: PROFILE_QUERY_KEY,
    // Only give up immediately on a definitive 401 (truly unauthenticated).
    // Allow up to 2 retries for transient 5xx / network errors so a cold-start
    // DB hiccup doesn't permanently destroy a valid "Remember Me" cookie.
    retry: (failureCount, error) => {
      const err = error as { status?: number };
      if (err?.status === 401 || err?.status === 404) return false;
      return failureCount < 2;
    },
    retryDelay: 1000,
    // While showing the saved copy, or the "couldn't load" screen, keep checking so live data takes over once
    // the server is back. A failure that is redirecting to the login page (expired session) is not rechecked.
    refetchInterval: (query) => {
      if (query.state.data?.fromCache) return CACHED_PROFILE_RECHECK_MS;
      const redirecting = Boolean((query.state.error as { redirectTo?: string } | null)?.redirectTo);
      return query.state.status === "error" && !redirecting ? PROFILE_ERROR_RECHECK_MS : false;
    },
    queryFn: async (): Promise<ProfileResult> => {
      // The saved copy is only used when the server (not the student's session) is the problem.
      const fromSavedCopy = async (): Promise<ProfileResult | null> => {
        const cached = await readCachedProfileForSession();
        return cached ? { student: cached.student, fromCache: true, savedAt: cached.savedAt } : null;
      };

      let response: Response;
      try {
        response = await fetch("/api/auth/profile");
      } catch (networkError) {
        const saved = await fromSavedCopy();
        if (saved) return saved;
        throw networkError;
      }
      // Tolerate a body that isn't JSON (e.g. a Next.js 500 HTML page on cold-start).
      const body: Record<string, unknown> = await response.json().catch(() => ({}));

      if (response.status === 401) {
        // Definitively unauthenticated — clear the invalid/expired cookie so the login
        // page's own server-side check doesn't see it and bounce them straight back here.
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        clearCacheOnLogout();
        throw { redirectTo: "/student-login", status: 401 };
      }

      if (response.ok && body.success) {
        const student = body.data as Student;
        // A brand-new row has nothing scraped yet; it must not replace a populated saved copy.
        if (hasScrapedData(student.details)) writeCachedProfile(student);
        return { student, fromCache: false, savedAt: null };
      }

      if (response.status >= 500) {
        const saved = await fromSavedCopy();
        if (saved) return saved;
      }

      // The database is back but has no row for someone who signed in while it was down. The saved copy is
      // never uploaded (the server trusts only the portal), so a normal sign-in is what creates the row.
      if (response.status === 404 && (await fromSavedCopy())) {
        throw { redirectTo: "/student-login?relogin=1&notice=server-back", status: 404 };
      }

      // Transient server / network error — throw a plain Error so TanStack Query
      // retries rather than treating this as a definitive auth failure.
      throw new Error(
        typeof body.message === "string"
          ? body.message
          : `Profile fetch failed (${response.status})`,
      );
    },
  });
  const loading = profileLoading;
  const student = profileResult?.student;
  const profileFromCache = profileResult?.fromCache ?? false;

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
      setPortalUnavailable(false);
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
      } else if (jobError === "browserless_token_invalid") {
        // Browserless rejected the saved token: send them to re-enter it (their PIN is still saved).
        router.push("/student-login?relogin=1&tokenRefresh=1");
      } else {
        setUpdateStatus("error");
        setUpdateError(jobError);
        setPortalUnavailable(failureKind === "portal_unavailable");
        setTimeout(() => setUpdateStatus(null), 4000);
      }
    }
  }, [jobStatus, jobError, failureKind, queryClient, student, router]);

  const detailsBlob = useMemo(() => student?.details || {}, [student]);
  const currentSem = useMemo(() => detailsBlob.subjects || detailsBlob.current_semester || [], [detailsBlob]);
  const examHistory = useMemo(() => student?.examHistory ?? [], [student]);

  const currentCgpa = useMemo(() => {
    const val = (student?.cgpa ?? "").trim();
    return val || null;
  }, [student]);

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
    return new Date(new Date(lastSync).getTime() + 1 * 60 * 1000).toISOString();
  }, [detailsBlob]);

  const { formatTime, isCooldownActive } = useCooldown(nextAllowedAt ?? derivedNextAllowedAt);

  // Exam results refresh on their own cooldown, measured from when they were last scraped.
  const derivedExamNextAllowedAt = useMemo(() => {
    if (!student?.examHistoryUpdatedAt) return null;
    return new Date(new Date(student.examHistoryUpdatedAt).getTime() + 1 * 60 * 1000).toISOString();
  }, [student]);

  const { formatTime: examFormatTime, isCooldownActive: isExamCooldownActive } = useCooldown(
    examNextAllowedAt ?? derivedExamNextAllowedAt,
  );

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
    // Use replace so tab switches don't stack browser history entries —
    // prevents the native back button from cycling through every tab visited.
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setSelectedSubject(null);
  };

  // When a subject is opened (state-only — no URL change), push a synthetic
  // history entry so the browser / device back button closes the detail view
  // instead of navigating all the way back to the login page.
  useEffect(() => {
    if (selectedSubject) {
      window.history.pushState({ subjectDetail: true }, "");
      const handlePop = () => setSelectedSubject(null);
      window.addEventListener("popstate", handlePop);
      return () => window.removeEventListener("popstate", handlePop);
    }
  }, [selectedSubject]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("[dashboard] logout request failed:", err);
    }
    clearCacheOnLogout();
    router.push("/");
  };

  // `current` re-fetches attendance and CIE marks, `exam_history` re-fetches exam results.
  const requestSync = async (scope: "current" | "exam_history") => {
    if (profileFromCache) {
      // The server (and its saved PIN) is unreachable, so a background sync cannot run. Signing in again
      // fetches straight from the portal.
      router.push("/student-login?relogin=1");
      return;
    }
    const cooldownActive = scope === "exam_history" ? isExamCooldownActive : isCooldownActive;
    if (cooldownActive || updateStatus === "loading") return;
    setUpdateStatus("loading");
    setUpdateError(null);
    try {
      const response = await fetch("/api/report/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usn: stdUsn, scope }),
      });
      const body = await response.json();

      if (response.status === 429) {
        setUpdateStatus(null);
        if (body.nextAllowedAt) {
          if (scope === "exam_history") setExamNextAllowedAt(body.nextAllowedAt);
          else setNextAllowedAt(body.nextAllowedAt);
        }
        return;
      }
      if (response.status === 401 && body.requiresRelogin) {
        // No saved portal PIN to sync with — send them to the login page's own secondary-auth
        // flow (same UI as first-time login) rather than asking for it again here.
        setUpdateStatus(null);
        router.push(body.requiresTokenRefresh ? "/student-login?relogin=1&tokenRefresh=1" : "/student-login?relogin=1");
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

  const handleUpdate = () => requestSync("current");
  const handleRefreshResults = () => requestSync("exam_history");

  // No live data and no saved copy: say so instead of spinning forever. A 401 is already redirecting to login.
  // `profileFailureCount` (not `profileError`) decides this: a refetch clears the error and goes back to
  // "loading", which would flash the splash over the screen and hide its "Checking…" state.
  const profileRedirecting = Boolean((profileError as { redirectTo?: string } | null)?.redirectTo);
  if (!student && profileFailureCount > 0 && !profileRedirecting) {
    return <ProfileUnavailable onRetry={() => void refetchProfile()} isRetrying={profileFetching} />;
  }
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
            { id: "settings", icon: <Settings size={20} />, label: "Settings" },
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
        <SidebarProfile user={student} onLogout={handleLogout} avatarSeedSuffix={avatarSeedSuffix} onAvatarChange={handleAvatarChange} />
      </aside>

      <header className="mobile-top-navbar">
        <div className="mobile-nav-brand">
          {selectedSubject && (
            <button 
              className="mobile-header-back-btn" 
              onClick={() => setSelectedSubject(null)}
              style={{ display: "flex", alignItems: "center", background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", padding: "4px" }}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <Image src="/logo-icon.svg" alt="logo" width={28} height={28} priority />
          <span className="mobile-app-name">MSR Insight</span>
        </div>
        <div className="mobile-nav-profile" style={{ position: "relative" }}>
          {student?.usn && !mobileImgError ? (
            <img
              src={`https://api.dicebear.com/10.x/bottts-neutral/svg?seed=${encodeURIComponent(student.usn + avatarSeedSuffix)}`}
              alt="Profile"
              style={{ width: 32, height: 32, cursor: "pointer", borderRadius: "50%", background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
              onClick={() => setShowMobileProfileMenu(!showMobileProfileMenu)}
              onError={() => setMobileImgError(true)}
            />
          ) : (
            <div
              className="profile-initials-avatar"
              style={{ width: 32, height: 32, fontSize: 12, cursor: "pointer" }}
              onClick={() => setShowMobileProfileMenu(!showMobileProfileMenu)}
            >
              {student?.name?.charAt(0) || "S"}
            </div>
          )}
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
                onClick={(e: React.MouseEvent) => {
                  handleAvatarChange(e);
                  setShowMobileProfileMenu(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "none",
                  border: "none",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  padding: "4px 0",
                  fontSize: "13px",
                  textAlign: "left",
                }}
              >
                Change Avatar
              </button>
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
          {profileFromCache && <ServerUnavailableBanner savedAt={profileResult?.savedAt ?? null} />}
          {portalUnavailable && <PortalUnavailableBanner lastUpdated={detailsBlob.last_updated} />}
          {updateError && updateStatus === "error" && !portalUnavailable && (
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
                  jobProgress={jobProgress}
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
                  onRefresh={handleRefreshResults}
                  isRefreshing={updateStatus === "loading"}
                  refreshCooldownActive={isExamCooldownActive}
                  refreshCooldownLabel={examFormatTime}
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
              {activeTab === "settings" && <SettingsSection />}
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
          { id: "settings", icon: <Settings size={20} />, label: "Settings" },
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
