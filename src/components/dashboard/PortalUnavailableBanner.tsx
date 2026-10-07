import { CloudOff } from "lucide-react";

function formatSavedAt(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Shown after a sync fails because the college portal could not be used. The dashboard keeps working
 * from what was saved, so this explains why the numbers may be old rather than reporting an error.
 */
export default function PortalUnavailableBanner({ lastUpdated }: { lastUpdated?: string }) {
  const savedAt = formatSavedAt(lastUpdated);

  return (
    <div className="portal-unavailable-banner" role="status">
      <CloudOff size={18} aria-hidden="true" />
      <p>
        <strong>The college portal isn&apos;t responding right now.</strong> You&apos;re seeing your saved data
        {savedAt ? ` from ${savedAt}` : ""}. Nothing was lost. Try Update Dashboard again in a few minutes.
      </p>
    </div>
  );
}
