import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

export type ScrapeJobStatus = "pending" | "running" | "success" | "failed";

export interface ScrapeJobStatusResponse {
  id: string;
  status: ScrapeJobStatus;
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
  const status = timedOut ? "failed" : query.data?.status ?? null;
  const error = timedOut
    ? "This is taking longer than expected. Please try updating again in a few minutes."
    : query.data?.error ?? null;

  return {
    status,
    error,
    resultSummary: query.data?.resultSummary ?? null,
    isSyncing: !!jobId && status !== "success" && status !== "failed",
  };
}
