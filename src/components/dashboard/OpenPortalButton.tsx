import { ExternalLink } from "lucide-react";

/**
 * Opens the official college portal in a new tab, past its first login page (the portal then asks for the
 * verification type and last 4 digits, which the student enters themselves).
 *
 * It is a plain same-site form POST (no client JavaScript): the server answers with a transient page that
 * submits the student's USN and date of birth to the portal (see src/app/api/portal/open/route.ts).
 * `noopener noreferrer` keeps the portal from reaching back to this tab.
 */
export default function OpenPortalButton() {
  return (
    <form method="post" action="/api/portal/open" target="_blank" rel="noopener noreferrer" className="header-action-form">
      <button type="submit" className="header-plain-btn" title="Open the official college portal, skipping its first login page">
        <ExternalLink size={16} aria-hidden="true" />
        <span>Official Site</span>
      </button>
    </form>
  );
}
