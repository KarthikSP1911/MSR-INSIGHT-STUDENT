import { ExternalLink } from "lucide-react";

/**
 * Opens the official college portal in a new tab, already signed in as this student.
 *
 * It is a plain same-site form POST (no client JavaScript) so the student's saved PIN never touches our
 * client code: the server answers with a transient page that signs the browser in to the portal (see
 * src/app/api/portal/open/route.ts). `noopener noreferrer` keeps the portal from reaching back to this tab.
 */
export default function OpenPortalButton() {
  return (
    <form method="post" action="/api/portal/open" target="_blank" rel="noopener noreferrer" className="header-action-form">
      <button type="submit" className="header-plain-btn" title="Open the official college portal, signed in as you">
        <ExternalLink size={16} aria-hidden="true" />
        <span>Official Site</span>
      </button>
    </form>
  );
}
