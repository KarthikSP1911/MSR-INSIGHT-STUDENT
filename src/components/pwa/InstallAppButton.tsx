"use client";

import { Download } from "lucide-react";

import { useInstallApp } from "./InstallProvider";
import "@/styles/InstallPrompt.css";

/**
 * "Install App" button, shown beside "Update Dashboard". It opens the browser's real install dialog when
 * there is one, otherwise the how-to card (see InstallPrompt). It renders nothing inside the installed
 * app, once the app is installed, and in browsers that can't install it (see isInstallAvailable).
 *
 * Deliberately plain: no hover lift, glow or shadow, unlike the Update button's call-to-action styling. On
 * phones it collapses to an icon-only circle so all header buttons fit on one line.
 */
export default function InstallAppButton() {
  const { available, install } = useInstallApp();
  if (!available) return null;

  return (
    <button type="button" className="header-plain-btn install-app-btn" onClick={() => void install()} title="Install MSR Insight on this device" aria-label="Install App">
      <Download size={16} aria-hidden="true" />
      <span>Install App</span>
    </button>
  );
}
