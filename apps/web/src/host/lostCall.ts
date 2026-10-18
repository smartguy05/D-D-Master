import type { DmStatus } from "@dm/shared";
import type { VoiceLinkState } from "../lib/voice";

/**
 * "Lost call" detection for /host: the browser's WebRTC call to OpenAI is still connected, but
 * the server has no DM attached to it (it restarted or crashed, and re-attaching failed). Players
 * can still talk to the DM, but no tools run. Pure so it can be unit-tested.
 */

/** How long the condition must hold before the banner shows (covers a quick server re-attach). */
export const LOST_CALL_GRACE_MS = 3000;

export interface LostCallInput {
  link: VoiceLinkState;
  dmStatus: DmStatus;
  /** /ws is connected, so dmStatus comes from a fresh server snapshot. */
  wsConnected: boolean;
}

function condition({ link, dmStatus, wsConnected }: LostCallInput) {
  return wsConnected && link === "connected" && dmStatus === "offline";
}

/** Next value of the "condition holds since" clock (null = not holding). */
export function offlineSince(prev: number | null, input: LostCallInput, now: number): number | null {
  if (!condition(input)) return null;
  return prev ?? now;
}

/** True when the banner should show. */
export function lostCall(input: LostCallInput & { offlineSince: number | null; now: number }): boolean {
  return condition(input) && input.offlineSince !== null && input.now - input.offlineSince >= LOST_CALL_GRACE_MS;
}
