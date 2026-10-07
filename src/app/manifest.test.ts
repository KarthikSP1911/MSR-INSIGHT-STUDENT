import { describe, expect, it } from "vitest";

import manifest from "./manifest";

/** Guards the properties browsers check before offering to install the app. */
describe("web app manifest", () => {
  const m = manifest();
  const icons = m.icons ?? [];

  it("opens as an app window, not a browser shortcut", () => {
    expect(m.display).toBe("standalone");
  });

  it("has the names and colors installers show", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.theme_color).toBeTruthy();
    expect(m.background_color).toBeTruthy();
    expect(m.id).toBe("/");
  });

  it("starts inside its own scope", () => {
    expect(m.scope).toBe("/");
    expect(m.start_url?.startsWith(m.scope ?? "/")).toBe(true);
  });

  it("ships 192px and 512px icons plus a maskable one", () => {
    expect(icons).toContainEqual(expect.objectContaining({ sizes: "192x192", purpose: "any", type: "image/png" }));
    expect(icons).toContainEqual(expect.objectContaining({ sizes: "512x512", purpose: "any", type: "image/png" }));
    expect(icons).toContainEqual(expect.objectContaining({ sizes: "512x512", purpose: "maskable", type: "image/png" }));
  });

  it("only points at icon files the icon route actually serves", () => {
    for (const icon of [...icons, ...(m.shortcuts ?? []).flatMap((s) => s.icons ?? [])]) {
      expect(icon.src).toMatch(/^\/icons\/(icon-192|icon-512|maskable-512)\.png$/);
    }
  });

  it("has shortcuts that stay inside the scope and open real dashboard tabs", () => {
    const shortcuts = m.shortcuts ?? [];
    expect(shortcuts.length).toBeGreaterThan(0);
    for (const s of shortcuts) {
      expect(s.url.startsWith("/student/dashboard?tab=")).toBe(true);
      expect(["history", "simulator", "notes"]).toContain(new URL(s.url, "http://x").searchParams.get("tab"));
    }
  });
});
