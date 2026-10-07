import Link from "next/link";

/**
 * Shown instead of an endless spinner when the profile could not be loaded and there is no saved copy on
 * this device to fall back to.
 */
export default function ProfileUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="login-page">
      <div className="login-card fade-in" role="alert">
        <header className="login-header">
          <h1 className="login-title">We couldn&apos;t load your dashboard</h1>
        </header>
        <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
          Our server isn&apos;t responding right now. Your data is safe. Please try again in a few minutes.
        </p>
        <button type="button" className="btn btn-primary login-btn" onClick={onRetry}>
          Try again
        </button>
        <p style={{ marginTop: 16, fontSize: 14 }}>
          <Link href="/student-login?relogin=1">Sign in again to fetch your data from the portal</Link>
        </p>
      </div>
    </div>
  );
}
