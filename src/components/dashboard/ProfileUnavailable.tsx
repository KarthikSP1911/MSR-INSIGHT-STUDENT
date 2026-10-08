import Link from "next/link";
import { ExternalLink, LogIn, MessageSquare, RefreshCw, ServerOff } from "lucide-react";

import { FEEDBACK_FORM_URL } from "@/lib/feedback";

interface ProfileUnavailableProps {
  onRetry: () => void;
  /** A recheck is in flight: the button shows progress and cannot be pressed again. */
  isRetrying: boolean;
}

/**
 * Shown instead of an endless spinner when the profile could not be loaded and there is no saved copy on
 * this device to fall back to. It says what happened and that the data is safe, keeps checking on its own
 * (the dashboard page rechecks every 30 seconds), and offers the two things a student can do meanwhile:
 * retry now, or sign in again to fetch straight from the college portal. Styled by `.profile-unavailable-*`
 * in StudentDashboard.css, which is loaded on this route (the login page's stylesheet is not).
 */
export default function ProfileUnavailable({ onRetry, isRetrying }: ProfileUnavailableProps) {
  return (
    <main className="profile-unavailable-page">
      <section className="profile-unavailable-card" aria-labelledby="profile-unavailable-title">
        <div className="profile-unavailable-icon" aria-hidden="true">
          <ServerOff size={28} />
        </div>

        <h1 id="profile-unavailable-title" className="profile-unavailable-title">
          We couldn&apos;t load your dashboard
        </h1>
        <p className="profile-unavailable-text">
          Our server isn&apos;t responding right now. Your account and data are safe.
        </p>

        <p className="profile-unavailable-status" role="status" aria-live="polite">
          <span className="profile-unavailable-dot" aria-hidden="true" />
          {isRetrying ? "Checking now…" : "We’ll keep checking automatically"}
        </p>

        <div className="profile-unavailable-actions">
          <button
            type="button"
            className="btn btn-primary profile-unavailable-action"
            onClick={onRetry}
            disabled={isRetrying}
            aria-busy={isRetrying}
          >
            <RefreshCw size={16} aria-hidden="true" className={isRetrying ? "profile-unavailable-spin" : undefined} />
            {isRetrying ? "Checking…" : "Try again"}
          </button>

          <Link className="btn btn-secondary profile-unavailable-action" href="/student-login?relogin=1">
            <LogIn size={16} aria-hidden="true" />
            Sign in again
          </Link>
          <p className="profile-unavailable-hint">
            Signing in again uses your portal PIN to fetch your latest data straight from the college portal.
          </p>
        </div>

        <a className="profile-unavailable-report" href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer">
          <MessageSquare size={14} aria-hidden="true" />
          Still stuck? Report a problem
          <ExternalLink size={12} aria-hidden="true" />
          <span className="profile-unavailable-sr">(opens in a new tab)</span>
        </a>
      </section>
    </main>
  );
}
