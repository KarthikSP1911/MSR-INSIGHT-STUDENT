"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Info, MessageSquare, HelpCircle } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { FEEDBACK_FORM_URL } from "@/lib/feedback";

function CollapsibleItem({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", overflow: "hidden", marginBottom: "12px", background: "var(--bg-surface)" }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: "100%", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", color: "var(--text-primary)", cursor: "pointer", textAlign: "left", transition: "background 0.2s ease" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "15px", fontWeight: 500 }}>
          {icon}
          {title}
        </div>
        {isOpen ? <ChevronDown size={18} color="var(--text-muted)" /> : <ChevronRight size={18} color="var(--text-muted)" />}
      </button>
      {isOpen && (
        <div style={{ padding: "0 16px 16px 16px", color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.5, animation: "fadeIn 0.2s ease-out" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function SettingsSection() {
  return (
    <div className="tab-content" style={{ animation: "fadeIn 0.3s ease-out" }}>
      <DashboardHeader
        sectionTitle="Settings"
        sectionSubtitle="Manage your dashboard preferences and account settings"
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <CollapsibleItem title="About" icon={<Info size={18} color="var(--accent-primary)" />}>
          <p>MSR Insight is a comprehensive dashboard designed for students to track their academic progress, attendance, and exam history seamlessly.</p>
          <p style={{ marginTop: "8px", fontWeight: 500 }}>Version 1.0.0</p>
        </CollapsibleItem>
        
        <CollapsibleItem title="Feedback Hub" icon={<MessageSquare size={18} color="var(--accent-primary)" />}>
          <p>We&apos;d love to hear your thoughts, suggestions, and feature requests to help improve MSR Insight.</p>
          <a 
            href={FEEDBACK_FORM_URL}
            target="_blank" 
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: "16px", padding: "10px 16px", background: "var(--accent-primary)", color: "#fff", borderRadius: "var(--radius-sm)", textDecoration: "none", fontSize: "13px", fontWeight: 600, transition: "opacity 0.2s ease" }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Submit Feedback via Google Form
          </a>
        </CollapsibleItem>

        <CollapsibleItem title="Frequently Asked Questions" icon={<HelpCircle size={18} color="var(--accent-primary)" />}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <h4 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Is my data compromised?</h4>
              <p>No, your data is completely secure. Sensitive credentials and tokens are stored in an encrypted format, meaning not even the administrators can view or access your raw credentials.</p>
            </div>
            <div>
              <h4 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Why is my attendance not updating?</h4>
              <p>Attendance is synced periodically from the portal. If you notice discrepancies, try manually refreshing using the update button on the Performance tab (subject to cooldowns).</p>
            </div>
            <div>
              <h4 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>What if the server is down?</h4>
              <p>This device keeps a copy of your last synced data (never your PIN), so the dashboard can still open and show it with a notice. If you did not tick &quot;Remember me&quot;, that copy is removed when you log out or close the tab. To update while the server is down, sign in again and enter your PIN.</p>
            </div>
            {/* <div>
              <h4 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>How is my SGPA calculated?</h4>
              <p>Your SGPA is calculated based on the credits and grades obtained in each course during the semester according to university guidelines.</p>
            </div>
            <div>
              <h4 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>Can I predict my future SGPA?</h4>
              <p>Yes! Head over to the Simulator tab to input expected grades and credits to see how they affect your overall CGPA and SGPA.</p>
            </div> */}
            
            
          </div>
        </CollapsibleItem>
      </div>
    </div>
  );
}
