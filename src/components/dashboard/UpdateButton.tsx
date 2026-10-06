import React, { useState } from "react";
import { RefreshCw, Clock } from "lucide-react";

interface UpdateButtonProps {
  onClick: () => void;
  isLoading: boolean;
  cooldownActive: boolean;
  formattedCooldown: string;
  /** Defaults to "Update Dashboard". */
  label?: string;
  /** Defaults to "Updating...". */
  loadingLabel?: string;
  /** Tooltip while idle; defaults to "Refresh dashboard data". */
  title?: string;
}

/** The main CTA for triggering a dashboard refresh — pulses on first load, shows a cooldown timer once used. */
export const UpdateButton: React.FC<UpdateButtonProps> = ({
  onClick,
  isLoading,
  cooldownActive,
  formattedCooldown,
  label = "Update Dashboard",
  loadingLabel = "Updating...",
  title = "Refresh dashboard data",
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const showGlow = !isLoading && !cooldownActive && !isHovered && !hasInteracted;

  const handleClick = () => {
    if (isLoading || cooldownActive) return;
    setHasInteracted(true);
    onClick();
  };

  return (
    <button
      className={`update-dashboard-btn ${showGlow ? "glow-cta" : ""} ${cooldownActive ? "cooldown" : ""}`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={isLoading || cooldownActive}
      title={cooldownActive ? `Cooldown active. Next update in ${formattedCooldown}` : title}
    >
      <div className="btn-content">
        {cooldownActive ? (
          <>
            <Clock size={18} className="btn-icon" />
            <span>
              <span className="cooldown-prefix">Next update in </span>
              {formattedCooldown}
            </span>
          </>
        ) : (
          <>
            <RefreshCw size={18} className={`btn-icon ${isLoading ? "spinning" : ""}`} />
            <span>{isLoading ? loadingLabel : label}</span>
          </>
        )}
      </div>
    </button>
  );
};
