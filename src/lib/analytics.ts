/**
 * analytics.ts
 *
 * Isolated PostHog integration — a "best effort" analytics layer.
 *
 * Rules:
 *  - Initializes only in the browser (client-side only).
 *  - If the env key/host is missing, skipped entirely (no console errors).
 *  - All errors during init or capture are swallowed silently so that
 *    a misconfigured key, network failure, or ad-blocker can never crash
 *    or block the rest of the app.
 *  - To disable analytics entirely: remove NEXT_PUBLIC_POSTHOG_KEY from .env.local.
 *  - To remove analytics entirely: delete this file and PostHogProvider.tsx,
 *    and remove <PostHogProvider> from layout.tsx.
 */

import posthog from "posthog-js";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let initialized = false;

/**
 * Call once on the client (e.g., inside a useEffect in PostHogProvider).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initAnalytics(): void {
  // Guard: server-side, already initialized, or key missing.
  if (typeof window === "undefined" || initialized || !POSTHOG_KEY) return;

  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST ?? "https://us.i.posthog.com",
      defaults: "2026-05-30",
    });
    initialized = true;
  } catch {
    // Intentionally silent — analytics must never crash the app.
  }
}

/**
 * Safe wrapper around posthog.capture().
 * If PostHog is not initialized, misconfigured, or blocked, this is a no-op.
 *
 * @param event  - The event name.
 * @param props  - Optional event properties.
 */
export function capture(
  event: string,
  props?: Record<string, unknown>
): void {
  if (!initialized) return;
  try {
    posthog.capture(event, props);
  } catch {
    // Intentionally silent.
  }
}

export { posthog };
