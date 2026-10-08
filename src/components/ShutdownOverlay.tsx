import { ExternalLink, PauseCircle } from "lucide-react";

import { PORTAL_BASE_URL } from "@/lib/scraper/portalHttpClient";
import "@/styles/ShutdownOverlay.css";

const COPY = {
  title: "Temporarily paused",
  body: "We've paused this dashboard while we sort out permission to access the college portal. Sign-in and data sync are switched off until then.",
  portalButton: "Open official portal",
};

/**
 * Blocks the login page while the site is paused (see src/lib/siteShutdown.ts). The portal link is a plain
 * link so the student's own browser goes to the college; this server never contacts it.
 */
export default function ShutdownOverlay() {
  return (
    <div className="shutdown-overlay" role="alertdialog" aria-modal="true" aria-labelledby="shutdown-title" aria-describedby="shutdown-body">
      <div className="shutdown-card">
        <PauseCircle className="shutdown-icon" size={44} aria-hidden="true" />
        <h2 id="shutdown-title" className="shutdown-title">
          {COPY.title}
        </h2>
        <p id="shutdown-body" className="shutdown-body">
          {COPY.body}
        </p>
        <a className="btn btn-primary shutdown-portal-link" href={PORTAL_BASE_URL} target="_blank" rel="noopener noreferrer">
          {COPY.portalButton}
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
