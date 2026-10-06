/** Rules for when the "install the app" prompt may appear. Kept free of React and the DOM so they can be tested. */

/** The prompt shows at most once per this long. */
export const INSTALL_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Wait a moment after the dashboard opens so the prompt doesn't compete with the page loading. */
export const INSTALL_PROMPT_DELAY_MS = 4000;

export const LAST_SHOWN_STORAGE_KEY = "msr-install-prompt-last-shown";
export const INSTALLED_STORAGE_KEY = "msr-app-installed";

export interface InstallPromptState {
  now: number;
  /** When the prompt was last shown (ms since epoch), or null if never. */
  lastShownAt: number | null;
  /** The student already installed the app (or is running it). */
  installed: boolean;
  /** This page is running inside the installed app. */
  standalone: boolean;
}

export function shouldShowInstallPrompt({ now, lastShownAt, installed, standalone }: InstallPromptState): boolean {
  if (installed || standalone) return false;
  if (lastShownAt === null || Number.isNaN(lastShownAt)) return true;
  // A device clock that was set back must not hide the prompt until the clock catches up.
  if (lastShownAt > now) return true;
  return now - lastShownAt >= INSTALL_PROMPT_INTERVAL_MS;
}

export interface InstallAvailability {
  /** This page is running inside the installed app. */
  standalone: boolean;
  /** We recorded an install earlier (cleared again if the browser offers installation, i.e. it was uninstalled). */
  installedFlag: boolean;
  /** The browser handed us a real install dialog (Chromium). */
  canInstallNatively: boolean;
  /** This browser can install web apps and fires `beforeinstallprompt` when the app isn't installed (Chromium). */
  supportsInstallEvent: boolean;
  /** The student opened the browser's install dialog and closed it without installing. */
  declinedNatively: boolean;
  isIos: boolean;
}

/**
 * Whether to show the "Install App" button.
 *
 * - Never inside the installed app, and never once we know it is installed.
 * - Chromium only fires `beforeinstallprompt` while the app is NOT installed, so the button is shown
 *   exactly when that dialog is available. If the student opened it and cancelled, the button stays so
 *   they can try again (the browser then re-offers, or the how-to card explains the menu).
 * - iOS has no install event and Safari can't tell whether the app is already on the home screen, so the
 *   how-to button is always available there.
 * - Other browsers (Firefox, desktop Safari) can't install the app, so there is no button.
 */
export function isInstallAvailable({
  standalone,
  installedFlag,
  canInstallNatively,
  supportsInstallEvent,
  declinedNatively,
  isIos,
}: InstallAvailability): boolean {
  if (standalone) return false;
  if (canInstallNatively) return true;
  if (isIos) return true;
  if (installedFlag) return false;
  return supportsInstallEvent && declinedNatively;
}

/** iPhone, iPad and iPod, including iPadOS which reports itself as a Mac but has a touch screen. */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** localStorage can throw (private mode, blocked site data), and the prompt must never break the page. */
export function readStoredNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function readStoredFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the worst case is the prompt shows again on the next visit.
  }
}
