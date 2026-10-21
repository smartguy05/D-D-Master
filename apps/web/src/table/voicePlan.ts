import type { DmMode, DmStatus, VoiceLinkState } from "@dm/shared";

/**
 * When /table rejoins a running voice DM by itself: after this page reloaded (or the browser
 * dropped it) while the server's DM is still up and no other table screen carries the call.
 * Once per page load; a refused or failed resume leaves it to the host's Reconnect button.
 * Pure so it can be unit-tested.
 */
export function shouldAutoResume(i: {
  wsConnected: boolean;
  dmMode: DmMode;
  dmStatus: DmStatus;
  /** This page's call. */
  link: VoiceLinkState;
  /** The call the server knows of (null until its snapshot arrived). */
  ownerLink: VoiceLinkState | null;
  tried: boolean;
}): boolean {
  if (i.tried || !i.wsConnected || i.ownerLink === null) return false;
  return i.dmMode === "voice" && i.dmStatus !== "offline" && i.link === "idle" && i.ownerLink === "idle";
}
