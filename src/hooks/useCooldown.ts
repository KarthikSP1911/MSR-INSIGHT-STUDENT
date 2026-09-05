import { useState, useEffect, useCallback } from "react";

/**
 * Manages the cooldown state for the dashboard update feature.
 * Calculates remaining time based on a target ISO timestamp.
 */
export const useCooldown = (nextAllowedAt: string | null) => {
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  const calculateRemaining = useCallback(() => {
    if (!nextAllowedAt) return 0;
    const next = new Date(nextAllowedAt).getTime();
    const now = Date.now();
    const diff = Math.ceil((next - now) / 1000);
    return diff > 0 ? diff : 0;
  }, [nextAllowedAt]);

  // Resets the countdown whenever nextAllowedAt changes, then a timer decrements it —
  // this is the documented "adjust state when a prop changes, then subscribe to an
  // external ticking clock" case React's own docs call out as needing an effect.
  useEffect(() => {
    const initial = calculateRemaining();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSecondsRemaining(initial);

    if (initial <= 0) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateRemaining]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  };

  const isCooldownActive = secondsRemaining > 0;

  return {
    secondsRemaining,
    formatTime: formatTime(secondsRemaining),
    isCooldownActive,
  };
};
