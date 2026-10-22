/**
 * The WebRTC call between remote players and the room (docs/web/online-call.md). Media goes peer to
 * peer; the server only relays signaling (offers, answers, ICE candidates) over /ws, checked here.
 */

/** Remote players in the call (plus the room, the /table screen carrying the voice DM). */
export const MAX_REMOTE_PEERS = 5;
/** Longest signaling payload relayed (JSON characters); an SDP with audio and video is a few KB. */
export const RTC_SIGNAL_MAX_CHARS = 32_000;
/** Longest ICE candidate line relayed. */
const CANDIDATE_MAX_CHARS = 1024;

/** What a call member shows the others: camera on air, the character card instead, mic on toward the players. */
export interface PeerPrefs {
  camera: boolean;
  showCharacter: boolean;
  /** Off = muted toward the other players (push-to-talk to the DM still goes through the room). */
  micOn: boolean;
}

/**
 * Why a page is not in the call (the `peers` event's refusedCode, next to the human `refused` text):
 * displaced: the same seat joined from another page; in_room: a home-network page (the room carries
 * it); no_seat: no seat, or the seat left the game; full: MAX_REMOTE_PEERS reached; not_member: a page
 * that never joins (/host, no access); other_table: another /table screen is the room.
 */
export const RTC_REFUSED_CODES = ["displaced", "in_room", "no_seat", "full", "not_member", "other_table"] as const;
export type RtcRefusedCode = (typeof RTC_REFUSED_CODES)[number];

/** One member of the call: a remote player's /play page, or the room (`room`, the /table screen). */
export interface PeerInfo extends PeerPrefs {
  /** Unique per connection ("room" for the table); also orders the perfect-negotiation roles. */
  peerId: string;
  room: boolean;
  /** The seat of a remote player (absent for the room). */
  playerId?: string;
}

export interface RtcIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** A signaling message between two members: a session description, or an ICE candidate (null = end of candidates). */
export type RtcSignal = { description: { type: "offer" | "answer" | "rollback"; sdp?: string } } | { candidate: RtcIceCandidate | null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const optStr = (v: unknown) => v === undefined || v === null || typeof v === "string";

/** A clean copy of a client's signaling payload, or undefined when it is malformed or too big. */
export function rtcSignal(raw: unknown): RtcSignal | undefined {
  if (!isObj(raw)) return undefined;
  if (isObj(raw.description)) {
    const { type, sdp } = raw.description;
    if (type === "rollback") return { description: { type } };
    if ((type !== "offer" && type !== "answer") || typeof sdp !== "string" || sdp.length > RTC_SIGNAL_MAX_CHARS) return undefined;
    return { description: { type, sdp } };
  }
  if ("candidate" in raw) {
    const c = raw.candidate;
    if (c === null) return { candidate: null };
    if (!isObj(c) || typeof c.candidate !== "string" || c.candidate.length > CANDIDATE_MAX_CHARS) return undefined;
    if (!optStr(c.sdpMid) || !optStr(c.usernameFragment)) return undefined;
    if (c.sdpMLineIndex !== undefined && c.sdpMLineIndex !== null && typeof c.sdpMLineIndex !== "number") return undefined;
    const out: RtcIceCandidate = { candidate: c.candidate };
    if (c.sdpMid !== undefined) out.sdpMid = c.sdpMid as string | null;
    if (c.sdpMLineIndex !== undefined) out.sdpMLineIndex = c.sdpMLineIndex as number | null;
    if (c.usernameFragment !== undefined) out.usernameFragment = c.usernameFragment as string | null;
    if (JSON.stringify(out).length > CANDIDATE_MAX_CHARS * 2) return undefined;
    return { candidate: out };
  }
  return undefined;
}

/** A client's prefs with every field a boolean (camera off, character off and mic on by default). */
export function peerPrefs(raw: unknown): PeerPrefs {
  const r = isObj(raw) ? raw : {};
  return { camera: r.camera === true, showCharacter: r.showCharacter === true, micOn: r.micOn !== false };
}
