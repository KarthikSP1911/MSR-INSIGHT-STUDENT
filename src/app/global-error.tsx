"use client";

import { useEffect } from "react";

/** Catches errors thrown by the root layout itself — must render its own <html>/<body> since it replaces it. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ opacity: 0.7, fontSize: 14 }}>Please try again — if the problem persists, refresh the page.</p>
          <button
            onClick={reset}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid currentColor", background: "transparent", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
