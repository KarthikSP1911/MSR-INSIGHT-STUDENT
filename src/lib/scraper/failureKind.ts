import { PortalAuthError, PortalLoginUnsupportedError, PortalUnavailableError } from "./portalHttpClient";

/**
 * Why a scrape failed, in terms the dashboard can act on. Stored in `scrape_jobs.resultSummary` (no schema
 * change) so the UI can tell "the portal is down, here is your saved data" apart from a real problem.
 */
export type ScrapeFailureKind = "portal_unavailable" | "credentials_rejected" | "other";

export function classifyScrapeFailure(error: unknown): ScrapeFailureKind {
  if (error instanceof PortalUnavailableError || error instanceof PortalLoginUnsupportedError) return "portal_unavailable";
  if (error instanceof PortalAuthError) return "credentials_rejected";
  return "other";
}
