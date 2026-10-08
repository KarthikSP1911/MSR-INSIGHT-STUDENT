import { ServerOff } from "lucide-react";

function formatSavedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Shown when the dashboard is rendering the copy saved on this device because our own database could not be
 * reached. Updating needs the server, so the banner points to signing in again, which fetches from the portal directly.
 */
export default function ServerUnavailableBanner({ savedAt }: { savedAt: string | null }) {
  const savedAtLabel = formatSavedAt(savedAt);

  return (
    <div className="portal-unavailable-banner" role="status">
      <ServerOff size={18} aria-hidden="true" />
      <p>
        <strong>Our server isn&apos;t responding right now.</strong> You&apos;re seeing the copy saved on this device
        {savedAtLabel ? ` from ${savedAtLabel}` : ""}. It will refresh on its own once the server is back.
      </p>
    </div>
  );
}
