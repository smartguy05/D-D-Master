import type { PeerPrefs, ServerEvent } from "@dm/shared";

/**
 * Small decisions of call/useCall.ts, pure so they can be tested (docs/web/online-call.md): when the
 * page's own mic opens and is released, when the page (re)joins the call, and when it re-sends its prefs.
 */

/** The call's own mic: open when wanted, release when no longer wanted (/table: the last remote left). */
export function micStep(want: boolean, open: boolean): "open" | "release" | "keep" {
  if (want && !open) return "open";
  if (!want && open) return "release";
  return "keep";
}

type PeersEvent = Extract<ServerEvent, { type: "peers" }>;

/**
 * This page lost its seat to the same seat joining from another page ("displaced"): it stays out (no
 * rejoin on a reconnect or a prefs change, or the two devices take the seat from each other forever)
 * until the user presses "Use this device". Back in the call clears it.
 */
export function displacedAfter(prev: boolean, ev: Pick<PeersEvent, "self" | "refusedCode">): boolean {
  if (ev.self !== null) return false;
  if (ev.refusedCode === "displaced") return true;
  return prev;
}

/** Send rtc_join now: the mesh is ready, /ws is up, and this page wasn't displaced. */
export function shouldJoin(o: { ready: boolean; connected: boolean; displaced: boolean }): boolean {
  return o.ready && o.connected && !o.displaced;
}

/**
 * The server's copy of this page's prefs (its own entry under `self`) differs from the last rtc_join
 * the page sent: that join was throttled (RTC_JOIN_MAX per RTC_RATE_WINDOW_MS, and the relay answers
 * with the call as it stands), so the others see old toggles. The page re-sends its join once the window
 * has passed (RESYNC_RETRY_MS). A plain echo that is merely behind a newer toggle also reads stale; the
 * retry is then a harmless repeat, cancelled when the matching echo arrives first.
 */
export function ownPrefsStale(sent: PeerPrefs | null, ev: Pick<PeersEvent, "self" | "peers">): boolean {
  if (!sent || ev.self === null) return false;
  const own = ev.peers.find((p) => p.peerId === ev.self);
  if (!own) return false;
  return own.camera !== sent.camera || own.showCharacter !== sent.showCharacter || own.micOn !== sent.micOn;
}

/** Wait before re-sending a throttled join: the server's RTC_RATE_WINDOW_MS (10 s), plus a margin. */
export const RESYNC_RETRY_MS = 10_500;
