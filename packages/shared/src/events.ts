import type { ActiveSpeaker, BoardEffect, Campaign, GameState, LogEntry, RollResult } from "./schemas.js";

export type DmStatus = "offline" | "connecting" | "listening" | "thinking" | "speaking";
export type DmMode = "voice" | "text" | "none";

/** Messages the server pushes to /host and /table over the /ws socket. */
export type ServerEvent =
  | { type: "state"; state: GameState }
  | { type: "campaign"; campaign: Campaign | null }
  | { type: "roll"; roll: RollResult }
  | { type: "log"; entry: LogEntry }
  | { type: "speaker"; speaker: ActiveSpeaker | null }
  | { type: "dm_status"; status: DmStatus; mode: DmMode }
  | { type: "job"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "enroll"; playerId: string; ok: boolean; samples: number; message: string }
  | { type: "error"; message: string }
  /** A synthesized NPC line (speak_as_npc); /table plays the mp3. */
  | { type: "npc_speech"; npcName: string; line: string; url: string }
  /** A short visual effect on the board (hit, heal, fireball...). Not persisted. */
  | { type: "effect"; effect: BoardEffect };

/** Messages clients send over /ws. */
export type ClientEvent = { type: "hello"; role: "host" | "table" | "player"; playerId?: string } | { type: "ping" };
