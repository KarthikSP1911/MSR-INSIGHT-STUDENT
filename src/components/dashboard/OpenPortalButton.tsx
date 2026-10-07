"use client";

import { ExternalLink } from "lucide-react";

import { useInstallApp } from "@/components/pwa/InstallProvider";

/**
 * Opens the official college portal, past its first login page (the portal then asks for the
 * verification type and last 4 digits, which the student enters themselves).
 *
 * It is a plain same-site form POST: the server answers with a transient page that submits the student's
 * USN and date of birth to the portal (see src/app/api/portal/open/route.ts).
 *
 * In a browser it opens a new tab (`noopener noreferrer` keeps the portal from reaching back to this one).
 * Inside the installed app it submits in the same window instead: the installed app turns a `_blank`
 * navigation into a plain GET of the form's action, dropping the POST, which the route answers with 405.
 */
export default function OpenPortalButton() {
  const { standalone } = useInstallApp();

  return (
    <form
      method="post"
      action="/api/portal/open"
      target={standalone ? "_self" : "_blank"}
      rel="noopener noreferrer"
      className="header-action-form"
    >
      <button type="submit" className="header-plain-btn" title="Open the official college portal, skipping its first login page">
        <ExternalLink size={16} aria-hidden="true" />
        <span>Official Site</span>
      </button>
    </form>
  );
}
