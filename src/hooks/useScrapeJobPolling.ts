import { useQuery } from "@tanstack/react-query";

export type ScrapeJobStatus = "pending" | "running" | "success" | "failed";

export interface ScrapeJobStatusResponse {
  id: string;
  status: ScrapeJobStatus;
  error: string | null;
  resultSummary: { subjectsCount: number; examHistoryCount: number } | null;
}

const TERMINAL_STATUSES: ScrapeJobStatus[] = ["success", "failed"];

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

  const status = query.data?.status ?? null;
  return {
    status,
    error: query.data?.error ?? null,
    resultSummary: query.data?.resultSummary ?? null,
    isSyncing: !!jobId && status !== "success" && status !== "failed",
  };
}
