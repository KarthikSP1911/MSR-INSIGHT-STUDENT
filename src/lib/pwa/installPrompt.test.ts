import { describe, expect, it } from "vitest";

import { INSTALL_PROMPT_INTERVAL_MS, isInstallAvailable, isIosDevice, shouldShowInstallPrompt } from "./installPrompt";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const base = { now: NOW, lastShownAt: null, installed: false, standalone: false };

describe("shouldShowInstallPrompt", () => {
  it("shows on the first visit", () => {
    expect(shouldShowInstallPrompt(base)).toBe(true);
  });

  it("does not show again within a day", () => {
    expect(shouldShowInstallPrompt({ ...base, lastShownAt: NOW - 60_000 })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, lastShownAt: NOW - INSTALL_PROMPT_INTERVAL_MS + 1 })).toBe(false);
  });

  it("shows again once a day has passed", () => {
    expect(shouldShowInstallPrompt({ ...base, lastShownAt: NOW - INSTALL_PROMPT_INTERVAL_MS })).toBe(true);
    expect(shouldShowInstallPrompt({ ...base, lastShownAt: NOW - 3 * INSTALL_PROMPT_INTERVAL_MS })).toBe(true);
  });

  it("never shows once installed, or inside the installed app", () => {
    expect(shouldShowInstallPrompt({ ...base, installed: true })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, standalone: true })).toBe(false);
    expect(shouldShowInstallPrompt({ ...base, installed: true, lastShownAt: NOW - 5 * INSTALL_PROMPT_INTERVAL_MS })).toBe(false);
  });

  it("is not hidden by a stored time in the future (clock set back) or a corrupt value", () => {
    expect(shouldShowInstallPrompt({ ...base, lastShownAt: NOW + 60_000 })).toBe(true);
    expect(shouldShowInstallPrompt({ ...base, lastShownAt: Number.NaN })).toBe(true);
  });
});

describe("isIosDevice", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

  it("detects iPhone and iPad", () => {
    expect(isIosDevice(iphone, 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)", 5)).toBe(true);
  });

  it("detects iPadOS that pretends to be a Mac, but not a real Mac", () => {
    expect(isIosDevice(mac, 5)).toBe(true);
    expect(isIosDevice(mac, 0)).toBe(false);
  });

  it("does not treat Android as iOS", () => {
    expect(isIosDevice(android, 5)).toBe(false);
  });
});

describe("isInstallAvailable", () => {
  const none = { standalone: false, installedFlag: false, canInstallNatively: false, supportsInstallEvent: false, declinedNatively: false, isIos: false };
  const chromium = { ...none, supportsInstallEvent: true };

  it("shows while Chromium offers the install dialog", () => {
    expect(isInstallAvailable({ ...chromium, canInstallNatively: true })).toBe(true);
  });

  it("is hidden in Chromium when the install dialog is not offered, which means the app is already installed", () => {
    expect(isInstallAvailable(chromium)).toBe(false);
  });

  it("stays available after the student opened the dialog and cancelled", () => {
    expect(isInstallAvailable({ ...chromium, declinedNatively: true })).toBe(true);
  });

  it("is hidden inside the installed app, whatever else is true", () => {
    expect(isInstallAvailable({ ...chromium, standalone: true, canInstallNatively: true })).toBe(false);
    expect(isInstallAvailable({ ...none, standalone: true, isIos: true })).toBe(false);
  });

  it("is hidden once we recorded an install, unless the browser offers installation again", () => {
    expect(isInstallAvailable({ ...chromium, installedFlag: true, declinedNatively: true })).toBe(false);
    expect(isInstallAvailable({ ...chromium, installedFlag: true, canInstallNatively: true })).toBe(true);
  });

  it("always offers the how-to on iOS, which cannot report whether the app is installed", () => {
    expect(isInstallAvailable({ ...none, isIos: true })).toBe(true);
  });

  it("has no button in browsers that cannot install web apps", () => {
    expect(isInstallAvailable(none)).toBe(false);
    expect(isInstallAvailable({ ...none, declinedNatively: true })).toBe(false);
  });
});
