/** Thrown by `withDbTimeout` when the database does not answer in time. */
export class DatabaseTimeoutError extends Error {
  constructor(ms: number) {
    super(`The database did not respond within ${ms}ms`);
    this.name = "DatabaseTimeoutError";
  }
}

/**
 * neon-http has no request timeout of its own, so a suspended database (quota used up, cold start that
 * never finishes) would hang a request until the platform kills it. Racing against a timer lets the caller
 * fall back to a degraded response instead.
 */
export function withDbTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DatabaseTimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * SQLSTATE classes meaning the server is unreachable, shutting down or refusing this app's login, not that
 * the query was wrong.
 */
const OUTAGE_SQLSTATE_PREFIXES = ["08", "28", "53", "57P"];
const OUTAGE_NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);
const MAX_CAUSE_DEPTH = 5;

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
  sourceError?: unknown;
}

function isOutageLink(err: ErrorLike): boolean {
  if (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "DatabaseTimeoutError") return true;
  if (err.name === "TypeError" && String(err.message ?? "").includes("fetch failed")) return true;

  const code = typeof err.code === "string" ? err.code : undefined;
  if (code && OUTAGE_NETWORK_CODES.has(code)) return true;
  const hasSqlState = code !== undefined && code.length === 5;
  if (hasSqlState && OUTAGE_SQLSTATE_PREFIXES.some((prefix) => code.startsWith(prefix))) return true;

  // An error Postgres itself raised about a query always carries a 5-character SQLSTATE. The Neon driver
  // reports everything else (an unreachable endpoint, a suspended compute, a rejected request) as a
  // NeonDbError whose code is undefined or "" (observed against a live driver), and none of those can serve
  // this app's queries.
  return err.name === "NeonDbError" && !hasSqlState;
}

/**
 * True when `err` means the database could not be reached or is not accepting queries. False for errors
 * the database itself raised about the query (constraint violations, bad SQL) — those are bugs or normal
 * races, not an outage, and must not trigger the degraded paths.
 *
 * Drizzle wraps driver errors in `DrizzleQueryError`, so the `cause` chain is followed.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null; depth++) {
    const link = current as ErrorLike;
    if (isOutageLink(link)) return true;
    current = link.cause ?? link.sourceError;
  }
  return false;
}
