import { useRef, type PointerEvent } from "react";

const DOUBLE_TAP_MS = 350;
const MAX_DRIFT_PX = 30;

interface Tap {
  time: number;
  x: number;
  y: number;
}

export function isDoubleTap(previous: Tap | null, next: Tap): boolean {
  return (
    previous !== null &&
    next.time - previous.time <= DOUBLE_TAP_MS &&
    Math.hypot(next.x - previous.x, next.y - previous.y) <= MAX_DRIFT_PX
  );
}

/**
 * Calls `onDoubleTap` on a second tap or click within 350ms, for touch and mouse alike. Taps on buttons, links and
 * inputs are ignored so tapping a control twice quickly (month arrows) does not count.
 */
export function useDoubleTap(onDoubleTap: () => void) {
  const last = useRef<Tap | null>(null);

  return (e: PointerEvent<HTMLElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;

    const tap = { time: e.timeStamp, x: e.clientX, y: e.clientY };
    if (isDoubleTap(last.current, tap)) {
      last.current = null;
      onDoubleTap();
      return;
    }
    last.current = tap;
  };
}
