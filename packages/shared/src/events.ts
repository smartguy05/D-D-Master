import type { ActiveSpeaker, BoardEffect, Campaign, GameState, LogEntry, RollResult } from "./schemas.js";

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
  | { type: "job"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "enroll"; playerId: string; ok: boolean; samples: number; message: string }
  | { type: "error"; message: string }
  /** A synthesized NPC line (speak_as_npc); /table plays the mp3. */
  | { type: "npc_speech"; npcName: string; line: string; url: string }
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
  | { type: "effect"; effect: BoardEffect };

/** Messages clients send over /ws. */
export type ClientEvent = { type: "hello"; role: "host" | "table" | "player"; playerId?: string } | { type: "ping" };
