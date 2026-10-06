"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Download, Share, X } from "lucide-react";

import {
  INSTALL_PROMPT_DELAY_MS,
  LAST_SHOWN_STORAGE_KEY,
  readStoredNumber,
  shouldShowInstallPrompt,
  writeStored,
} from "@/lib/pwa/installPrompt";
import { useInstallApp } from "./InstallProvider";
import "@/styles/InstallPrompt.css";

type CardMode = "native" | "ios" | "generic";

/** The full-screen splash (LoadingScreen) covers everything, including this prompt. */
const SPLASH_SELECTOR = ".fresh-loading-container";
const SPLASH_RECHECK_MS = 1500;

/**
 * The install card. It appears in two ways:
 *
 * 1. Automatically, at most once every 24 hours, for a signed-in student whose browser can install the
 *    app (Chrome/Edge/Android get an Install button; iOS gets the Share -> Add to Home Screen steps).
 *    The "last shown" time is recorded when it appears, so reloading never nags, and it waits for the
 *    loading splash to clear so the day's slot isn't spent on a prompt nobody could see.
 * 2. On demand, when the student taps the "Install App" button and their browser has no install dialog
 *    (iOS, or a browser that only offers it from its menu).
 *
 * Mounted from the (dashboard) layout, so it only exists for signed-in pages.
 */
export default function InstallPrompt() {
  const { ready, standalone, installedFlag, isIos, canInstallNatively, helpOpen, install, closeHelp } = useInstallApp();
  const [dailyMode, setDailyMode] = useState<"native" | "ios" | null>(null);

  const offer = canInstallNatively ? "native" : isIos ? "ios" : null;

  useEffect(() => {
    if (!ready || standalone || !offer) return;

    const eligible = () =>
      shouldShowInstallPrompt({
        now: Date.now(),
        lastShownAt: readStoredNumber(LAST_SHOWN_STORAGE_KEY),
        installed: installedFlag,
        standalone,
      });
    if (!eligible()) return;

    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      if (!eligible()) return;
      // Wait out the splash (e.g. a first-time sync) so the student actually sees the prompt
      // before it uses up today's slot.
      if (document.querySelector(SPLASH_SELECTOR)) {
        timer = setTimeout(show, SPLASH_RECHECK_MS);
        return;
      }
      writeStored(LAST_SHOWN_STORAGE_KEY, String(Date.now()));
      setDailyMode(offer);
    };
    timer = setTimeout(show, INSTALL_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, standalone, installedFlag, offer]);

  // A button-requested card takes priority; a native card only makes sense while the browser still holds
  // its install dialog (it is gone once used or once the app is installed).
  const mode: CardMode | null = helpOpen
    ? isIos
      ? "ios"
      : "generic"
    : dailyMode === "native" && !canInstallNatively
      ? null
      : dailyMode;

  const dismiss = useCallback(() => {
    setDailyMode(null);
    closeHelp();
  }, [closeHelp]);

  useEffect(() => {
    if (!mode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mode, dismiss]);

  if (!mode) return null;

  return (
    <div className="install-prompt" role="dialog" aria-labelledby="install-prompt-title" aria-describedby="install-prompt-text">
      <Image src="/logo-icon.svg" alt="" width={40} height={40} className="install-prompt-logo" />
      <div className="install-prompt-body">
        <h2 id="install-prompt-title" className="install-prompt-title">
          Install MSR Insight
        </h2>
        <p id="install-prompt-text" className="install-prompt-text">
          {mode === "ios" && (
            <>
              Add it to your home screen: tap <Share size={14} className="install-prompt-inline-icon" aria-label="Share" /> in
              your browser, then choose <strong>Add to Home Screen</strong>.
            </>
          )}
          {mode === "generic" && (
            <>
              Open your browser&apos;s menu and choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>).
            </>
          )}
          {mode === "native" && "Open your attendance and marks in one tap, straight from your home screen."}
        </p>
        <div className="install-prompt-actions">
          {mode === "native" && (
            <button
              type="button"
              className="install-prompt-primary"
              onClick={() => {
                setDailyMode(null);
                void install();
              }}
            >
              <Download size={16} aria-hidden="true" />
              Install
            </button>
          )}
          <button type="button" className="install-prompt-secondary" onClick={dismiss}>
            {mode === "native" ? "Not now" : "Got it"}
          </button>
        </div>
      </div>
      <button type="button" className="install-prompt-close" onClick={dismiss} aria-label="Close install prompt">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
