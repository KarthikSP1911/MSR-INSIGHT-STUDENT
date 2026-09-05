"use client";

/**
 * PostHogProvider.tsx
 *
 * Client Component that initializes PostHog exactly once on mount.
 * Wrapping in a try/catch inside initAnalytics() means any failure
 * (missing key, network error, ad-blocker) is silently ignored and
 * never reaches this component or the rest of the app.
 *
 * To disable: remove NEXT_PUBLIC_POSTHOG_KEY from .env.local.
 * To remove:  delete this file and src/lib/analytics.ts, and remove
 *             <PostHogProvider> from layout.tsx.
 */

import { useEffect } from "react";
import { initAnalytics } from "@/lib/analytics";

export default function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // initAnalytics is fully guarded — safe to call unconditionally.
    initAnalytics();
  }, []);

  return <>{children}</>;
}
