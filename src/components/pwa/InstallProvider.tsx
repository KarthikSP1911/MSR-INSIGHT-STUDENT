"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  INSTALLED_STORAGE_KEY,
  isInstallAvailable,
  isIosDevice,
  readStoredFlag,
  writeStored,
} from "@/lib/pwa/installPrompt";

/** Chromium's install event; not in lib.dom.d.ts because it is not a web standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallContextValue {
  /** Browser state has been read (it is unknown during server rendering and the first paint). */
  ready: boolean;
  standalone: boolean;
  installedFlag: boolean;
  isIos: boolean;
  /** The browser gave us a real install dialog. */
  canInstallNatively: boolean;
  /** Show the "Install App" button. */
  available: boolean;
  /** The button asked for the how-to-install card (iOS, or a browser with no install dialog). */
  helpOpen: boolean;
  /** Opens the browser's install dialog, or the how-to card when there isn't one. */
  install: () => Promise<void>;
  closeHelp: () => void;
}

const NOT_READY: InstallContextValue = {
  ready: false,
  standalone: false,
  installedFlag: false,
  isIos: false,
  canInstallNatively: false,
  available: false,
  helpOpen: false,
  install: async () => {},
  closeHelp: () => {},
};

const InstallContext = createContext<InstallContextValue>(NOT_READY);

export function useInstallApp(): InstallContextValue {
  return useContext(InstallContext);
}

/**
 * Owns the browser's one-shot `beforeinstallprompt` event so that the daily prompt and the
 * "Install App" button share it. It must live above both: the event fires once, early, and a button
 * that mounts later (say, after switching tabs) would otherwise never see it.
 */
export default function InstallProvider({ children }: { children: React.ReactNode }) {
  const [browser, setBrowser] = useState({
    ready: false,
    standalone: false,
    installedFlag: false,
    isIos: false,
    supportsInstallEvent: false,
  });
  const [canInstallNatively, setCanInstallNatively] = useState(false);
  const [declinedNatively, setDeclinedNatively] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // Running as the installed app: remember it so a later visit in a normal tab doesn't ask again.
    if (standalone) writeStored(INSTALLED_STORAGE_KEY, "1");

    // Reading browser-only state once on mount is the case this rule's own docs allow an effect for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowser({
      ready: true,
      standalone,
      installedFlag: standalone || readStoredFlag(INSTALLED_STORAGE_KEY),
      isIos: isIosDevice(navigator.userAgent, navigator.maxTouchPoints),
      supportsInstallEvent: "onbeforeinstallprompt" in window,
    });

    const onBeforeInstallPrompt = (event: Event) => {
      // Take over from the browser's own mini-infobar; the install UI stays in the browser menu.
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      // Browsers only offer installation when the app is not installed, so a stale "installed"
      // flag (the app was uninstalled) is wrong.
      writeStored(INSTALLED_STORAGE_KEY, "0");
      setBrowser((b) => ({ ...b, installedFlag: false }));
      setCanInstallNatively(true);
      setDeclinedNatively(false);
    };
    const onAppInstalled = () => {
      writeStored(INSTALLED_STORAGE_KEY, "1");
      deferredPrompt.current = null;
      setCanInstallNatively(false);
      setHelpOpen(false);
      setBrowser((b) => ({ ...b, installedFlag: true }));
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const event = deferredPrompt.current;
    if (!event) {
      setHelpOpen(true);
      return;
    }
    deferredPrompt.current = null; // a browser prompt can only be used once
    setCanInstallNatively(false);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") {
        writeStored(INSTALLED_STORAGE_KEY, "1");
        setBrowser((b) => ({ ...b, installedFlag: true }));
      } else {
        // The one-shot dialog is spent but the app isn't installed: keep the button so they can retry.
        setDeclinedNatively(true);
      }
    } catch (err) {
      console.error("[pwa] install prompt failed:", err);
      setDeclinedNatively(true);
    }
  }, []);

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const value = useMemo<InstallContextValue>(
    () => ({
      ...browser,
      canInstallNatively,
      available: browser.ready && isInstallAvailable({ ...browser, canInstallNatively, declinedNatively }),
      helpOpen,
      install,
      closeHelp,
    }),
    [browser, canInstallNatively, declinedNatively, helpOpen, install, closeHelp],
  );

  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}
