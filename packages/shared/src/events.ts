import type { ActiveSpeaker, BoardEffect, Campaign, GameState, LogEntry, Moment, RollResult } from "./schemas.js";
import type { PeerInfo, PeerPrefs, RtcRefusedCode, RtcSignal } from "./rtc.js";

export type DmStatus = "offline" | "connecting" | "listening" | "thinking" | "speaking";
export type DmMode = "voice" | "text" | "none";

/** The NPC close-up on the TV. */
export interface NpcFocusView {
  name: string;
  /** The NPC's drawn portrait (token sprite or pre-drawn outline NPC), if any. */
  portraitUrl?: string;
}

/**
 * Someone at the table is talking right now (Realtime speech_started → speech_stopped), with the
 * mic level and, once voice ID is sure mid-sentence, a provisional speaker. The final speaker of
 * the turn still comes as a `speaker` event. Not persisted.
 */
export interface TalkState {
  who: "player";
  active: boolean;
  /** Mic level 0–1 (RMS, scaled). */
  level?: number;
  playerId?: string;
  /** Voice ID from partial audio; the turn's `speaker` event replaces it. */
  provisional?: boolean;
}

/** The browser's WebRTC call to the voice DM (VoiceLink on /table). */
export type VoiceLinkState = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

/**
 * Who carries the voice call. /table runs the mic, the DM's audio and the WebRTC call; /host only
 * sends commands. `table`: a /table screen is connected. `link`: its call (or the owner's, with
 * several open). `micStream`: a /table mic stream feeds voice ID.
 */
export interface VoiceOwnerView {
  table: boolean;
  link: VoiceLinkState;
  error?: string;
  micStream: boolean;
}

/**
 * Push-to-talk floor (who is talking to the DM). `room`: someone at the table holds Space on /table.
 * A player holds it from their phone or remote page; `inRoom` is true when that page is on the home
 * network (its voice reaches the DM through the room mic), false for a remote player.
 */
export type FloorHolder = { playerId: string; inRoom: boolean } | { room: true };

/** The floor as clients see it: `pushToTalk` off = open mic as before (the floor is unused). */
export interface FloorView {
  pushToTalk: boolean;
  holder: FloorHolder | null;
  /**
   * ms left on the current hold before the server lets go of it (FLOOR_MAX_HOLD_MS), as of when this
   * was sent; omitted when nobody holds it. Relative, not a timestamp: a phone's clock may be off.
   */
  holdLeftMs?: number;
  /** A voice is being enrolled (SpeakerService.enrolling): /table keeps the room mic open so it can be recorded. Omitted when false. */
  enrolling?: boolean;
}

/** After a release, the room mic stays open and the turn still counts as covered for this long. */
export const FLOOR_TAIL_MS = 600;
/** A hold longer than this is released automatically (a forgotten button or a stuck key). */
export const FLOOR_MAX_HOLD_MS = 30_000;

/** One pick_up for the TV toast (item icons, gold). Not persisted. */
export interface Pickup {
  characterId: string;
  characterName: string;
  items: { name: string; qty: number; iconUrl?: string }[];
  gold: number;
}

/** Messages the server pushes to /host and /table over the /ws socket. */
export type ServerEvent =
  | { type: "state"; state: GameState }
  | { type: "campaign"; campaign: Campaign | null }
  | { type: "roll"; roll: RollResult }
  | { type: "log"; entry: LogEntry }
  | { type: "speaker"; speaker: ActiveSpeaker | null }
  | { type: "dm_status"; status: DmStatus; mode: DmMode }
  /** Table mic hard mute (the DM hears nothing). `by`: the player who toggled it from a phone. */
  | { type: "mic"; muted: boolean; by?: string }
  | { type: "job"; id: string; label: string; status: "running" | "done" | "error"; detail?: string; startedAt: number }
  | { type: "enroll"; playerId: string; ok: boolean; samples: number; message: string }
  /**
   * A voice ID test finished (Party tab, nothing saved): the best match (`playerId`, absent when
   * nothing was scored) and every voiceprint's cosine score, best first.
   */
  | { type: "voice_test"; ok: boolean; message: string; playerId?: string; confident?: boolean; scores: { playerId: string; score: number }[] }
  | { type: "error"; message: string }
  /**
   * A synthesized line (speak_as_npc, or an AI player's line: `pc`, with its sprite as `portraitUrl`);
   * /table plays the mp3 and shows the speaker's close-up with the line as subtitles.
   */
  | { type: "npc_speech"; npcName: string; line: string; url: string; portraitUrl?: string; pc?: boolean }
  /** The NPC the DM is voicing (npc_focus / speak_as_npc): /table shows its close-up. null = none. */
  | { type: "npc_focus"; focus: NpcFocusView | null }
  /**
   * What the focused NPC is saying (the DM's audio transcript), streamed; `id` = one spoken reply.
   * Not final: `text` is a piece to append. Final: `text` is the whole reply.
   */
  | { type: "caption"; caption: { id: string; npcName: string; text: string; final: boolean } }
  /** Live "who's talking" (see TalkState), ~8 level updates per second while someone speaks. */
  | { type: "talk"; talk: TalkState }
  /** A short visual effect on the board (hit, heal, fireball...). Not persisted. */
  | { type: "effect"; effect: BoardEffect }
  /**
   * A table moment (victory, death, revived, turn banner, campaign end) for the TV overlay.
   * Not persisted and not part of the snapshot a new socket gets.
   */
  | { type: "moment"; moment: Moment }
  /** An AI player is thinking, speaking (with the line) or idle again; /host shows it. Not persisted. */
  | { type: "ai_player"; playerId: string; status: "idle" | "thinking" | "speaking"; line?: string }
  /** A character picked up loot (pick_up): /table shows a toast with the item icons. Not persisted. */
  | { type: "pickup"; pickup: Pickup }
  /** Who carries the voice call (see VoiceOwnerView); in the snapshot. */
  | { type: "voice_owner"; owner: VoiceOwnerView }
  /** Push-to-talk: the setting and who holds the floor (see FloorView); in the snapshot, sent to players too. */
  | { type: "floor"; floor: FloorView }
  /** To the /table screen that carries the call: start a call, hang up, or rebuild it (resume). */
  | { type: "voice_command"; action: "start" | "stop" | "reconnect" }
  /**
   * Silent voice-call renewal before the 60 min Realtime cap (for the /table call; others ignore it).
   * prepare: build a standby peer with the mic muted and POST its offer to /api/dm/voice?handover=1.
   * swap: unmute the standby, play its audio, close the old peer. abort: close the standby, keep the old one.
   */
  | { type: "voice_handover"; phase: "prepare" | "swap" | "abort" }
  /**
   * The WebRTC call (docs/web/online-call.md), only to sockets that joined it: `self` is this socket's
   * peer id (null: not in the call, `refused` says why and `refusedCode` names it), `peers` every
   * member, this one included.
   */
  | { type: "peers"; self: string | null; peers: PeerInfo[]; refused?: string; refusedCode?: RtcRefusedCode }
  /** A signaling message from another call member (relayed by the server, checked by rtcSignal). */
  | { type: "rtc"; from: string; signal: RtcSignal }
  /**
   * A player's character draft changed (phone creation). No content: the draft is private to that
   * seat, so its phone (and the host) refetch it over REST. Not persisted.
   */
  | { type: "creation"; playerId: string; status: "draft" | "pending" | "returned" | "joined" | "none"; updatedAt: number; busy?: boolean };

/** Messages clients send over /ws. */
export type ClientEvent =
  | { type: "hello"; role: "host" | "table" | "player"; playerId?: string }
  | { type: "ping" }
  /** /table: its voice call changed state (drives voice_owner for /host). */
  | { type: "voice_link"; state: VoiceLinkState; error?: string }
  /**
   * Push-to-talk pressed (down) or released. From /table without `playerId`: the room. From a phone or
   * remote page: its seat (a player cookie may only press for its own seat; the server checks).
   */
  | { type: "ptt"; down: boolean; playerId?: string }
  /**
   * Join the WebRTC call, or update this member's prefs. /table (table access) joins as the room; a
   * remote /play page as its seat (`playerId` only for a caller that may act for any seat). Home-network
   * /player phones never join: they are in the room.
   */
  | { type: "rtc_join"; prefs: PeerPrefs; playerId?: string }
  | { type: "rtc_leave" }
  /** A signaling message to another member of the call. */
  | { type: "rtc"; to: string; signal: RtcSignal };
