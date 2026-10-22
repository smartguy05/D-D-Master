import { useEffect, useMemo, useState } from "react";
import type { FloorView } from "@dm/shared";
import { HOLD_WARN_MS, holdSecondsLeft } from "./floor";

/**
 * Seconds left on the current push-to-talk hold in its last HOLD_WARN_MS before the server's 30 s cap
 * (lib/floor.ts holdSecondsLeft), re-rendering each second while it counts; undefined otherwise.
 * The floor's `holdLeftMs` is counted from when this page got that floor (a new object per update).
 */
export function useHoldCountdown(floor: FloorView | null): number | undefined {
  const receivedAt = useMemo(() => Date.now(), [floor]);
  const [, tick] = useState(0);
  const left = floor?.pushToTalk && floor.holder ? floor.holdLeftMs : undefined;
  useEffect(() => {
    if (left === undefined) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      tick((n) => n + 1);
      interval = setInterval(() => tick((n) => n + 1), 250);
    };
    const wait = receivedAt + left - HOLD_WARN_MS - Date.now();
    const timer = setTimeout(start, Math.max(0, wait));
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [receivedAt, left]);
  return holdSecondsLeft(floor, receivedAt, Date.now());
}
