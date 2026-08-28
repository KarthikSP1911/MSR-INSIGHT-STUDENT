"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";

interface DropdownRect {
  top: number;
  left: number;
  width: number;
}

const CustomSelect = ({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const close = () => setIsOpen(false);

  // Positioned via a fixed-position portal to document.body rather than inline: an inline
  // absolutely-positioned dropdown is confined to the nearest ancestor with overflow set (the
  // scrollable .login-card), so it gets clipped instead of floating above it.
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    // Scrolling the long options list (e.g. the 50-year list) itself fires a "scroll" event
    // that's caught here in the capture phase too — ignore those so the list stays open while
    // the user scrolls it, and only close for scrolls elsewhere on the page.
    const handleScroll = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isOpen]);

  return (
    <div className="custom-select-container">
      <div ref={triggerRef} className="select-trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className={value ? "value-text" : "placeholder-text"}>{value || placeholder}</span>
        <span className="chevron">▼</span>
      </div>
      {isOpen &&
        dropdownRect &&
        createPortal(
          <>
            <div className="select-overlay" onClick={close} />
            <div
              ref={dropdownRef}
              className="select-dropdown"
              style={{ top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
            >
              {options.map((opt) => (
                <div
                  key={opt}
                  className={`select-option ${value === opt ? "selected" : ""}`}
                  onClick={() => {
                    onChange(opt);
                    close();
                  }}
                >
                  {opt}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [usn, setUsn] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");

  const [showSecondaryAuth, setShowSecondaryAuth] = useState(false);
  const [authType, setAuthType] = useState("Father's Mobile");
  const [last4Digits, setLast4Digits] = useState("");

  const [loading, setLoading] = useState(false);
  // Seeded lazily from ?error= — carried here when a first-time login's scrape
  // failed (wrong USN/DOB/PIN) and the dashboard bounced back with the reason.
  const [error, setError] = useState(() => searchParams.get("error") || "");
  const [infoMsg, setInfoMsg] = useState("");

  const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 50 }, (_, i) => String(currentYear - i - 15));
  const authOptions = ["Father's Mobile", "Mother's Mobile", "ABC ID"];

  // Arrives here as ?relogin=1 when an already-signed-in dashboard hit an account with no
  // saved portal PIN (old account, or a first sync that never completed) — reuses this same
  // secondary-auth section rather than a separate in-dashboard modal. USN/DOB come from the
  // still-valid session instead of the URL, since DOB shouldn't travel in a query string.
  useEffect(() => {
    if (searchParams.get("relogin") !== "1") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/auth/profile");
        const body = await res.json();
        if (cancelled || !res.ok || !body.success) return;

        const [d, m, y] = String(body.data?.dob || "").split("-");
        if (!d || !m || !y) return;

        setUsn(body.data?.usn || "");
        setDay(String(parseInt(d, 10)));
        setMonth(months[parseInt(m, 10) - 1] || "");
        setYear(y);
        setShowSecondaryAuth(true);
        setInfoMsg("Please re-verify your portal PIN to continue syncing your dashboard.");
      } catch (err) {
        // Session fetch failed — leave the form blank for a normal fresh login instead.
        console.error("[LoginForm] relogin session fetch failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the relogin param this page was loaded with, not on every render
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usn || !day || !month || !year) {
      setError("Please fill in all basic fields (USN and Date of Birth)");
      return;
    }

    if (showSecondaryAuth) {
      if (!authType) {
        setError("Please select a verification method");
        return;
      }
      if (!last4Digits || last4Digits.length !== 4) {
        setError("Please enter the exact last 4 digits");
        return;
      }
    }

    setError("");
    setInfoMsg("");
    setLoading(true);

    const monthIndex = String(months.indexOf(month) + 1).padStart(2, "0");
    const formattedDay = String(day).padStart(2, "0");
    const formattedDate = `${formattedDay}-${monthIndex}-${year}`;

    try {
      const payload: Record<string, unknown> = {
        usn: usn.trim().toUpperCase(),
        dob: formattedDate,
      };
      if (showSecondaryAuth) {
        payload.authType = authType;
        payload.last4Digits = last4Digits;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (result.requiresSecondaryAuth) {
        setShowSecondaryAuth(true);
        setInfoMsg(
          "Portal verification required for first-time login. Please select your verification method and enter the last 4 digits.",
        );
        setLoading(false);
        return;
      }

      if (!response.ok || !result.success) {
        setError(result.message || "Invalid credentials or login failed");
        setLoading(false);
        return;
      }

      const jobId = result.data?.jobId as string | null | undefined;
      router.push(jobId ? `/student/dashboard?syncJobId=${jobId}` : "/student/dashboard");
    } catch (err) {
      console.error("[LoginForm] login request failed:", err);
      setError("Invalid credentials or login failed");
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in">
        <header className="login-header">
          <h1 className="login-title">Student Portal</h1>
        </header>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label">University Seat Number</label>
            <input
              type="text"
              className="input-field"
              value={usn}
              onChange={(e) => setUsn(e.target.value.toUpperCase().replace(/\s+/g, ""))}
              placeholder="1MS20AB000"
              autoComplete="off"
              name="usn"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <div className="dob-grid">
              <CustomSelect value={day} onChange={setDay} options={days} placeholder="Day" />
              <CustomSelect value={month} onChange={setMonth} options={months} placeholder="Month" />
              <CustomSelect value={year} onChange={setYear} options={years} placeholder="Year" />
            </div>
          </div>

          {showSecondaryAuth && (
            <div className="secondary-auth-section fade-in">
              <div className="secondary-header">
                <h3>Portal Verification Required</h3>
                <p>Select option and enter the last 4 digits</p>
              </div>

              <div className="form-group">
                <label className="form-label">Verification Option</label>
                <CustomSelect
                  value={authType}
                  onChange={setAuthType}
                  options={authOptions}
                  placeholder="Select Method"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Last 4 Digits</label>
                <input
                  type="password"
                  maxLength={4}
                  className="input-field pin-input"
                  value={last4Digits}
                  onChange={(e) => setLast4Digits(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                />
              </div>
            </div>
          )}

          {!showSecondaryAuth && (
            <button
              type="button"
              className="toggle-secondary-btn"
              onClick={() => setShowSecondaryAuth(true)}
            >
              First time login or updating portal PIN? Click here
            </button>
          )}

          {infoMsg && <div className="form-info">{infoMsg}</div>}
          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? "Verifying & Syncing..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
