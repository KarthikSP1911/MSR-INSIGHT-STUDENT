"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <div className="custom-select-container">
      <div className="select-trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className={value ? "value-text" : "placeholder-text"}>{value || placeholder}</span>
        <span className="chevron">▼</span>
      </div>
      {isOpen && (
        <div className="select-dropdown">
          {options.map((opt) => (
            <div
              key={opt}
              className={`select-option ${value === opt ? "selected" : ""}`}
              onClick={() => {
                onChange(opt);
                setIsOpen(false);
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
      {isOpen && <div className="select-overlay" onClick={() => setIsOpen(false)} />}

      <style jsx>{`
        .custom-select-container {
          position: relative;
          flex: 1;
        }
        .select-trigger {
          background: var(--bg-primary);
          border: 1px solid var(--border-subtle);
          padding: 9px 12px;
          border-radius: var(--radius-md);
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.85rem;
          transition: all 0.2s ease;
        }
        .select-trigger:hover {
          border-color: var(--border-bright);
          background: var(--bg-secondary);
        }
        .value-text {
          color: var(--text-primary);
        }
        .placeholder-text {
          color: var(--text-muted);
        }
        .chevron {
          font-size: 8px;
          color: var(--text-muted);
          opacity: 0.7;
        }
        .select-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          max-height: 200px;
          overflow-y: auto;
          z-index: 100;
          box-shadow: var(--shadow-lg);
          padding: 4px;
        }
        .select-option {
          padding: 8px 12px;
          cursor: pointer;
          border-radius: var(--radius-sm);
          font-size: 0.85rem;
          color: var(--text-secondary);
          transition: all 0.2s ease;
        }
        .select-option:hover {
          background: var(--bg-surface);
          color: var(--text-primary);
        }
        .select-option.selected {
          background: var(--bg-surface);
          color: var(--text-primary);
          font-weight: 600;
        }
        .select-overlay {
          position: fixed;
          inset: 0;
          z-index: 90;
        }
      `}</style>
    </div>
  );
};

export default function LoginForm() {
  const router = useRouter();
  const [usn, setUsn] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");

  const [showSecondaryAuth, setShowSecondaryAuth] = useState(false);
  const [authType, setAuthType] = useState("Father's Mobile");
  const [last4Digits, setLast4Digits] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 50 }, (_, i) => String(currentYear - i - 15));
  const authOptions = ["Father's Mobile", "Mother's Mobile", "ABC ID"];

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
    } catch {
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

      <style jsx>{`
        .login-page {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 24px 16px;
          background: var(--bg-primary);
        }
        .login-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 28px 28px 36px;
          max-height: 100%;
          overflow-y: auto;
          scrollbar-width: none;
          width: 100%;
          max-width: 380px;
          box-shadow: var(--shadow-lg);
        }
        .login-card::-webkit-scrollbar {
          display: none;
        }
        .login-header {
          margin-bottom: 18px;
          text-align: center;
        }
        .login-title {
          font-size: 1.4rem;
          font-weight: 800;
          color: var(--text-primary);
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .form-label {
          margin-bottom: 4px;
          font-size: 0.8rem;
        }
        .input-field {
          padding: 9px 12px;
          font-size: 0.9rem;
        }
        .dob-grid {
          display: flex;
          gap: 8px;
        }
        .login-btn {
          margin-top: 6px;
          font-weight: 600;
          height: 40px;
        }
        .form-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: var(--error, #ef4444);
          padding: 8px;
          border-radius: var(--radius-md);
          font-size: 0.8rem;
          text-align: center;
        }
        .form-info {
          background: var(--bg-surface, rgba(255, 255, 255, 0.03));
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          padding: 8px 12px;
          border-radius: var(--radius-md);
          font-size: 0.8rem;
          text-align: center;
          line-height: 1.35;
        }
        .secondary-auth-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px;
          background: var(--bg-surface, rgba(255, 255, 255, 0.03));
          border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          border-radius: var(--radius-md);
        }
        .secondary-header h3 {
          font-size: 0.88rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 2px;
        }
        .secondary-header p {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .pin-input {
          letter-spacing: 0.25em;
          font-size: 1rem;
          text-align: center;
          font-weight: 700;
        }
        .toggle-secondary-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 0.75rem;
          cursor: pointer;
          text-decoration: underline;
          padding: 2px 0;
          text-align: center;
          transition: color 0.2s ease;
        }
        .toggle-secondary-btn:hover {
          color: var(--text-primary);
        }

        @media (max-width: 480px) {
          .login-page {
            padding: 16px 12px;
          }
          .login-card {
            padding: 20px 16px 26px;
            border-radius: var(--radius-md);
          }
          .dob-grid {
            gap: 6px;
          }
          .login-title {
            font-size: 1.2rem;
          }
        }
      `}</style>
    </div>
  );
}
