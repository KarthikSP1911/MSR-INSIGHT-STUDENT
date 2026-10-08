"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

const SECTIONS = [
  {
    title: "What this service does",
    body: "MSR Insight shows your attendance, internal (CIE) marks and exam results in one place. To do that, it signs in to the college parent portal and reads those pages on your behalf. This is called scraping.",
  },
  {
    title: "Your consent",
    body: "We scrape the college parent portal with your consent. By ticking the box and signing in, you agree that we may log in to it as you, using the USN, date of birth and verification digits you provide, and collect your attendance, CIE marks and exam results.",
  },
  {
    title: "What we keep",
    body: "We save your USN, date of birth and the academic data we collect so the dashboard can open without waiting on the portal. The verification digits you enter are stored encrypted, only so we can refresh your data later. Your data is shown only to you, when you are signed in.",
  },
  {
    title: "What we do not touch",
    body: "We do not read or store any placement information from the portal.",
  },
  {
    title: "Stopping",
    body: "You can stop at any time by signing out. To ask for your saved data to be deleted, send a request through the Feedback Hub button on the login page.",
  },
  {
    title: "Accuracy",
    body: "This is not the college's official system. Our copy can be out of date or incomplete, so the official portal is always the record to rely on.",
  },
];

/** Native <dialog>, so the browser handles the focus trap, Escape and the backdrop. */
export default function TermsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="terms-dialog"
      aria-labelledby="terms-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="terms-header">
        <h2 id="terms-title" className="terms-title">
          Terms and Conditions
        </h2>
        <button type="button" className="terms-close" onClick={onClose} aria-label="Close terms and conditions">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="terms-content">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
      <div className="terms-footer">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
