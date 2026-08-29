import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

export type ScrapeJobStatus = "pending" | "running" | "success" | "failed";

export interface ScrapeJobStatusResponse {
  id: string;
  status: ScrapeJobStatus;
  progress: string | null;
  error: string | null;
  resultSummary: { subjectsCount: number; examHistoryCount: number } | null;
}

const TERMINAL_STATUSES: ScrapeJobStatus[] = ["success", "failed"];

// The worker itself gives up on a wedged scrape after 4 minutes (JOB_TIMEOUT_MS in
// worker/scraper-worker.ts) and marks the job "failed" — this is a client-side backstop for
// the case that never reaches us at all (worker process down, crashed, or a job stuck in
// "pending"/"running" from before that timeout existed), so the dashboard doesn't spin
// forever instead of surfacing an error.
const MAX_POLL_MS = 6 * 60 * 1000;

/**
 * Polls /api/scrape-jobs/[id] every ~2s until the job reaches a terminal
 * status. This is how the frontend "waits" for a scrape that now runs
 * asynchronously in the standalone worker, instead of MSR-Insight's
 * single blocking request.
 */
export function useScrapeJobPolling(jobId: string | null) {
  const query = useQuery<ScrapeJobStatusResponse>({
    queryKey: ["scrapeJob", jobId],
    enabled: !!jobId,
    // Mobile browsers commonly drop/throttle background-tab requests (app-switch, screen
    // lock), so a transient failure here is expected, not exceptional — retry a few times
    // before giving up rather than surfacing a stall as a hard error on the first blip.
    retry: 3,
    retryDelay: 2000,
    queryFn: async () => {
      const res = await fetch(`/api/scrape-jobs/${jobId}`);
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.message || "Failed to fetch job status");
      }
      return body.data as ScrapeJobStatusResponse;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || TERMINAL_STATUSES.includes(status)) return false;
      return 2000;
    },
    // Keep polling (and retry immediately) once the tab/app comes back to the foreground —
    // on mobile the OS can fully suspend a backgrounded tab's timers, so without this the
    // poll can silently stop until the user notices and manually refreshes.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Which jobId (if any) has been polled past MAX_POLL_MS without reaching a terminal
  // status — a sentinel rather than a plain boolean so a new jobId is "not timed out" for
  // free, with no separate reset call needed when the id changes.
  const [timedOutJobId, setTimedOutJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const timer = setTimeout(() => setTimedOutJobId(jobId), MAX_POLL_MS);
    return () => clearTimeout(timer);
  }, [jobId]);

  const timedOut = timedOutJobId !== null && timedOutJobId === jobId;
  // query.isError means every retry above was exhausted (e.g. the session cookie went stale
  // mid-sync, or the network never recovered) — surface that as a terminal failure right away
  // rather than making the user wait out the full MAX_POLL_MS backstop for the same outcome.
  const status = timedOut || query.isError ? "failed" : query.data?.status ?? null;
  const error = timedOut
    ? "This is taking longer than expected. Please try updating again in a few minutes."
    : query.isError
      ? "Lost connection while checking your sync status. Please try again."
      : query.data?.error ?? null;

  return {
    status,
    progress: query.data?.progress ?? null,
    error,
    resultSummary: query.data?.resultSummary ?? null,
    isSyncing: !!jobId && status !== "success" && status !== "failed",
  };
}
