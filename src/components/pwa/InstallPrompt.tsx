"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Download, Share, X } from "lucide-react";

import {
  INSTALL_PROMPT_DELAY_MS,
  INSTALLED_STORAGE_KEY,
  LAST_SHOWN_STORAGE_KEY,
  isIosDevice,
  readStoredFlag,
  readStoredNumber,
  shouldShowInstallPrompt,
  writeStored,
} from "@/lib/pwa/installPrompt";
import "@/styles/InstallPrompt.css";

/** Chromium's install event; not in lib.dom.d.ts because it is not a web standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "hidden" | "native" | "ios";

/** The full-screen splash (LoadingScreen) covers everything, including this prompt. */
const SPLASH_SELECTOR = ".fresh-loading-container";
const SPLASH_RECHECK_MS = 1500;

/**
 * Asks a signed-in student to install the app, at most once every 24 hours.
 *
 * - Chrome/Edge/Android: captures `beforeinstallprompt` and offers a real Install button.
 * - iOS (Safari and friends have no install API): shows the Share -> Add to Home Screen steps.
 * - Other browsers, or the already-installed app: shows nothing.
 *
 * Mounted from the (dashboard) layout, so it only exists for signed-in pages. The "last shown" time is
 * recorded when the prompt appears, not when it is dismissed, so reloading never nags.
 */
export default function InstallPrompt() {
  const [mode, setMode] = useState<Mode>("hidden");
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (standalone) {
      // Running as the installed app: remember it so a later visit in a normal tab doesn't ask again.
      writeStored(INSTALLED_STORAGE_KEY, "1");
      return;
    }

    const eligible = () =>
      shouldShowInstallPrompt({
        now: Date.now(),
        lastShownAt: readStoredNumber(LAST_SHOWN_STORAGE_KEY),
        installed: readStoredFlag(INSTALLED_STORAGE_KEY),
        standalone: false,
      });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = (next: Exclude<Mode, "hidden">) => {
      if (!eligible()) return;
      const show = () => {
        if (!eligible()) return;
        // Wait out the splash (e.g. a first-time sync) so the student actually sees the prompt
        // before it uses up today's slot.
        if (document.querySelector(SPLASH_SELECTOR)) {
          timer = setTimeout(show, SPLASH_RECHECK_MS);
          return;
        }
        writeStored(LAST_SHOWN_STORAGE_KEY, String(Date.now()));
        setMode(next);
      };
      clearTimeout(timer);
      timer = setTimeout(show, INSTALL_PROMPT_DELAY_MS);
    };

    const onBeforeInstallPrompt = (event: Event) => {
      // Take over from the browser's own mini-infobar; the install UI stays available in the menu.
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      reveal("native");
    };
    const onAppInstalled = () => {
      writeStored(INSTALLED_STORAGE_KEY, "1");
      deferredPrompt.current = null;
      clearTimeout(timer);
      setMode("hidden");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    if (isIosDevice(navigator.userAgent, navigator.maxTouchPoints)) reveal("ios");

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const dismiss = useCallback(() => setMode("hidden"), []);

  useEffect(() => {
    if (mode === "hidden") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mode, dismiss]);

  const install = async () => {
    const event = deferredPrompt.current;
    if (!event) return;
    deferredPrompt.current = null; // a browser prompt can only be used once
    setMode("hidden");
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") writeStored(INSTALLED_STORAGE_KEY, "1");
    } catch (err) {
      console.error("[pwa] install prompt failed:", err);
    }
  };

  if (mode === "hidden") return null;

  return (
    <div className="install-prompt" role="dialog" aria-labelledby="install-prompt-title" aria-describedby="install-prompt-text">
      <Image src="/logo-icon.svg" alt="" width={40} height={40} className="install-prompt-logo" />
      <div className="install-prompt-body">
        <h2 id="install-prompt-title" className="install-prompt-title">
          Install MSR Insight
        </h2>
        <p id="install-prompt-text" className="install-prompt-text">
          {mode === "ios" ? (
            <>
              Add it to your home screen: tap <Share size={14} className="install-prompt-inline-icon" aria-label="Share" /> in
              your browser, then choose <strong>Add to Home Screen</strong>.
            </>
          ) : (
            "Open your attendance and marks in one tap, straight from your home screen."
          )}
        </p>
        <div className="install-prompt-actions">
          {mode === "native" && (
            <button type="button" className="install-prompt-primary" onClick={install}>
              <Download size={16} aria-hidden="true" />
              Install
            </button>
          )}
          <button type="button" className="install-prompt-secondary" onClick={dismiss}>
            {mode === "ios" ? "Got it" : "Not now"}
          </button>
        </div>
      </div>
      <button type="button" className="install-prompt-close" onClick={dismiss} aria-label="Close install prompt">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
