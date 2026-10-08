import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FEEDBACK_FORM_URL } from "@/lib/feedback";
import ProfileUnavailable from "./ProfileUnavailable";

// next/link needs the App Router at runtime; for markup assertions a plain anchor is equivalent.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const render = (isRetrying: boolean) => renderToStaticMarkup(createElement(ProfileUnavailable, { onRetry: () => {}, isRetrying }));

describe("ProfileUnavailable", () => {
  it("says what happened and reassures the student their data is safe", () => {
    const html = render(false);

    expect(html).toContain("We couldn&#x27;t load your dashboard");
    expect(html).toContain("Your account and data are safe");
  });

  it("offers retry, sign in again and a way to report the problem", () => {
    const html = render(false);

    expect(html).toContain("Try again");
    expect(html).toMatch(/<a[^>]*href="\/student-login\?relogin=1"[^>]*>[\s\S]*Sign in again/);
    expect(html).toContain(`href="${FEEDBACK_FORM_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("tells the student it keeps checking by itself", () => {
    expect(render(false)).toContain("keep checking automatically");
  });

  it("is a labelled region with a polite live status, for screen readers", () => {
    const html = render(false);

    expect(html).toContain('aria-labelledby="profile-unavailable-title"');
    expect(html).toContain('id="profile-unavailable-title"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("shows progress and blocks a second press while a recheck is running", () => {
    const html = render(true);

    expect(html).toContain("Checking…");
    expect(html).toContain("Checking now…");
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("profile-unavailable-spin");
  });

  it("leaves the retry button pressable when idle", () => {
    const html = render(false);

    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain("profile-unavailable-spin");
  });
});
