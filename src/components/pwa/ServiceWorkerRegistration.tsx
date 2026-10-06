"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js (offline page only, see public/sw.js). Skipped in development so a stale worker
 * never interferes with hot reload; test it with `npm run build && npm start`.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.error("[pwa] service worker registration failed:", err));
  }, []);

  return null;
}
