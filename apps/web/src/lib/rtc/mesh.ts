import type { FloorView, PeerInfo, PeerPrefs } from "@dm/shared";

/**
 * The call's pure rules (docs/web/online-call.md); PeerMesh (peerMesh.ts) is the RTCPeerConnection glue.
 *
 * Every member connects to every other one (a full mesh: at most 5 remote players and the room). Each
 * pair uses "perfect negotiation": the polite side yields when both offer at once. The impolite side
 * builds the connection: it adds three transceivers, one per slot (mic, the DM's voice, camera), so both
 * pages agree on what each m-line carries by its index and tracks change with replaceTrack, without
 * renegotiating.
 */

/** Transceiver order on every connection. `dm` carries the voice DM's audio, sent only by the room. */
export const SLOTS = ["mic", "dm", "cam"] as const;
export type Slot = (typeof SLOTS)[number];

/** Default video: 360 lines at about 300 kbps (setParameters). */
export const VIDEO_TARGET_HEIGHT = 360;
export const VIDEO_MAX_BITRATE = 300_000;

/** The polite side of a pair yields on an offer collision; the other side builds the connection. Same answer on both pages. */
export function isPolite(self: string, other: string): boolean {
  return self < other;
}

/** The slot an m-line index carries (getTransceivers() order). */
export function slotOf(index: number): Slot | undefined {
  return SLOTS[index];
}

/** Connections to open (members this page has none with) and to close (members who left, or all when this page left). */
export function meshDiff(have: Iterable<string>, self: string | null, peers: PeerInfo[]): { open: PeerInfo[]; close: string[] } {
  const haveSet = new Set(have);
  const want = self ? peers.filter((p) => p.peerId !== self) : [];
  const wantIds = new Set(want.map((p) => p.peerId));
  return { open: want.filter((p) => !haveSet.has(p.peerId)), close: [...haveSet].filter((id) => !wantIds.has(id)) };
}

/**
 * This seat holds the push-to-talk floor, or let go less than the tail ago (`tailUntil`): its voice
 * must reach the room (and so the DM) even when it is muted toward the other players.
 */
export function holdsOwnFloor(floor: FloorView | null, playerId: string | undefined, tailUntil: number, now: number): boolean {
  const h = floor?.holder;
  if (h && "playerId" in h && h.playerId === playerId) return true;
  return now < tailUntil;
}

/**
 * The track one slot sends to one member: the camera only when it is on and the character card isn't
 * shown instead; the mic when it is on toward the players, or toward the room while this player talks
 * to the DM; the DM's voice whenever there is one (only the room has it).
 */
export function slotTrack<T>(slot: Slot, o: { local: Record<Slot, T | null>; prefs: PeerPrefs; towardRoom: boolean; holdingFloor: boolean }): T | null {
  if (slot === "cam") return o.prefs.camera && !o.prefs.showCharacter ? o.local.cam : null;
  if (slot === "mic") return o.prefs.micOn || (o.towardRoom && o.holdingFloor) ? o.local.mic : null;
  return o.local.dm;
}

/** Encoding for a camera track `height` lines tall: scaled down to 360 lines, capped at ~300 kbps. */
export function videoEncoding(height: number | undefined): { maxBitrate: number; scaleResolutionDownBy: number } {
  const scale = height && height > VIDEO_TARGET_HEIGHT ? height / VIDEO_TARGET_HEIGHT : 1;
  return { maxBitrate: VIDEO_MAX_BITRATE, scaleResolutionDownBy: scale };
}
